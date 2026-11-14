import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EngineAudio } from '../audio/EngineAudio';
import { Music } from '../audio/Music';
import { Party, makeCode, normaliseCode } from '../net/Party';
import { RemotePlayers } from '../net/RemotePlayers';
import { vehicleById as vehById } from '../vehicles/registry';
import { PostFX } from '../effects/PostFX';
import { Rain } from '../effects/Rain';
import { VehicleFX } from '../effects/VehicleFX';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { VEHICLES, vehicleById } from '../vehicles/registry';
import { loadSave, storeSave } from './Save';
import type { DriveInput } from './Input';
import { Vehicle } from '../vehicles/Vehicle';
import type { VehicleConfig } from '../vehicles/VehicleConfig';
import { VehicleVisual } from '../vehicles/VehicleVisual';
import { makeNeonEnvironment } from '../world/materials';
import { buildCity } from '../world/City';
import { karachi } from '../world/cities/karachi';
import { buildTestTrack, type World } from '../world/TestTrack';
import { CameraRig } from './CameraRig';
import { Input } from './Input';
import { QUALITY, QUALITY_ORDER, type QualityLevel, loadQuality, saveQuality } from './Quality';

const FIXED_DT = 1 / 60;
const EMOTES = ['👋', '😂', '🔥', '🏁'];
const PARKED: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: true, boost: false, horn: false };

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.25, 4000);
  readonly input = new Input();
  readonly audio = new EngineAudio();
  readonly hud: Hud;
  physics!: RAPIER.World;
  vehicle!: Vehicle;
  visual!: VehicleVisual;
  world!: World;
  rig: CameraRig;
  quality: QualityLevel = loadQuality();
  paused = false;
  /** 'menu' shows the car in a showroom orbit; 'drive' hands control to the player. */
  mode: 'menu' | 'drive' = 'menu';
  readonly music = new Music();
  readonly save = loadSave();
  menu!: Menu;
  readonly party = new Party();
  remotes!: RemotePlayers;
  private switching = 0;
  /** Simulated seconds; exposed for tests. */
  time = 0;

  private events!: RAPIER.EventQueue;
  private fx!: VehicleFX;
  private post!: PostFX;
  private acc = 0;
  private last = 0;
  private slowFrames = 0;
  private fastStart = 0;
  private roadTimer = 0;
  private rain = new Rain(1400);
  private baseFog = 0;

  constructor(private canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, stencil: false, depth: false, powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.rig = new CameraRig(this.camera);
    this.scene.add(this.camera);
    this.hud = new Hud(uiRoot);
    this.input.mountTouchControls(uiRoot);
    this.input.onFirstGesture = () => {
      this.audio.start();
      this.music.start();
    };
    this.audio.volume = this.save.sfx;
    this.music.volume = this.save.music;
    this.menu = new Menu(uiRoot, {
      vehicles: VEHICLES,
      currentVehicle: () => this.vehicle.config,
      selectVehicle: (cfg) => this.setVehicle(cfg),
      setColors: (p, n, a) => {
        this.visual.setColors(p, n, a);
        queueMicrotask(() => this.party.updateInfo(this.myInfo()));
        this.save.colors[this.vehicle.config.id] = { paint: p, neon: n, accent: a };
        storeSave(this.save);
      },
      drive: () => this.setMode('drive'),
      resume: () => this.setMode('drive'),
      toTitle: () => {
        this.vehicle.reset(this.world.spawn.position, this.world.spawn.yaw);
        this.setMode('menu');
      },
      quality: () => this.quality,
      setQuality: (q) => this.setQuality(q),
      volumes: () => ({ music: this.save.music, sfx: this.save.sfx }),
      setVolumes: (m, s) => {
        this.save.music = this.music.volume = m;
        this.save.sfx = this.audio.volume = s;
        storeSave(this.save);
      },
      party: () => ({
        code: this.party.code,
        connected: this.party.connected,
        hostId: this.party.host?.id ?? '',
        selfId: this.party.id,
        players: this.party.players.map((p) => ({ id: p.id, name: p.name, vehicle: vehById(p.vehicle).name, neon: p.neon })),
      }),
      playerName: () => this.save.name,
      setName: (n) => {
        this.save.name = n.trim() || this.save.name;
        storeSave(this.save);
        this.party.updateInfo(this.myInfo());
      },
      createParty: () => this.party.join(makeCode('KHI'), this.myInfo()),
      joinParty: async (raw) => {
        const code = normaliseCode(raw);
        if (!code) throw new Error('Codes look like KHI-7Q2');
        await this.party.join(code, this.myInfo());
      },
      leaveParty: () => this.party.leave(),
      raining: () => this.rain.target > 0,
      setRain: (on) => (this.rain.target = on ? 1 : 0),
    });

    this.input.on((a) => {
      if (a === 'pause') {
        if (this.mode === 'drive') {
          this.setMode('menu');
          this.menu.show('pause');
        } else if (this.menu.screen === 'pause') {
          this.menu.show('none');
          this.setMode('drive');
        }
        return;
      }
      if (this.mode !== 'drive') return;
      if (a === 'chat') return this.hud.focusChat();
      if (a.startsWith('emote')) return this.party.chat(EMOTES[+a.slice(5) - 1], true);
      switch (a) {
        case 'reset': this.vehicle.reset(); break;
        case 'camera': this.hud.toast(`CAMERA · ${this.rig.cycle().toUpperCase()}`); break;
        case 'help': this.hud.toggleHelp(); break;
        case 'weather':
          this.rain.target = this.rain.target > 0 ? 0 : 1;
          this.hud.toast(this.rain.target ? 'WEATHER · MONSOON' : 'WEATHER · CLEAR');
          break;
        case 'mute': this.hud.toast(this.audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON'); break;
        case 'quality': {
          const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.quality) + 1) % QUALITY_ORDER.length];
          this.setQuality(next);
          break;
        }
      }
    });
    window.addEventListener('resize', () => this.resize());
  }

  async init(vehicleConfig: VehicleConfig = vehicleById(this.save.vehicle)) {
    await RAPIER.init();
    const q = QUALITY[this.quality];
    this.physics = new RAPIER.World({ x: 0, y: -15, z: 0 });
    this.physics.timestep = FIXED_DT;
    this.events = new RAPIER.EventQueue(true);

    this.scene.environment = makeNeonEnvironment(this.renderer);
    // ?world=test loads the Phase 1 proving ground instead of the city
    const testTrack = new URLSearchParams(location.search).get('world') === 'test';
    this.world = testTrack ? buildTestTrack(this.physics, q) : await buildCity(this.physics, q, karachi);
    if (this.world.minimap) this.hud.setMiniMap(this.world.minimap);
    if (this.world.attribution) this.hud.setAttribution(this.world.attribution);
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.FogExp2(this.world.fogColor, this.world.fogDensity);
    this.scene.background = this.world.fogColor;
    this.baseFog = this.world.fogDensity;
    this.scene.add(this.rain.mesh);

    this.vehicle = new Vehicle(this.physics, vehicleConfig, this.world.spawn);
    this.visual = new VehicleVisual(vehicleConfig);
    await this.visual.load();
    this.scene.add(this.visual.root);

    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.rig.obstacle = (from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.01) return 1;
      ray.origin.x = from.x; ray.origin.y = from.y; ray.origin.z = from.z;
      ray.dir.x = dx / len; ray.dir.y = dy / len; ray.dir.z = dz / len;
      const hit = this.physics.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      return hit ? hit.timeOfImpact / len : 1;
    };

    this.buildQualityDependent();
    this.resize();
    this.setMode('menu');

    // ---- multiplayer
    this.remotes = new RemotePlayers(this.physics, this.party.id);
    this.scene.add(this.remotes.group);
    this.remotes.onHorn = (d) => this.audio.remoteHorn(d);
    this.party.onRoster = (list) => {
      this.remotes.setRoster(list);
      this.hud.setParty(this.party.code, list.length);
      this.menu.refresh();
    };
    this.party.onSnapshot = (from, s) => this.remotes.push(from, s);
    this.party.onChat = (line) => {
      this.hud.addChat(line.name, line.text, line.from === this.party.id);
      if (line.from !== this.party.id) this.remotes.say(line.from, line.text);
    };
    this.hud.onChatSend = (text) => this.party.chat(text);
    const invite = normaliseCode(new URLSearchParams(location.search).get('party') ?? '');
    if (invite) {
      this.menu.pendingCode = invite;
      this.menu.show('party');
    }
  }

  private myInfo() {
    const c = this.vehicle.config;
    return { name: this.save.name, vehicle: c.id, paint: c.colors.paint, neon: c.colors.neon, accent: c.colors.accent };
  }

  setMode(mode: 'menu' | 'drive') {
    this.mode = mode;
    this.hud.setVisible(mode === 'drive');
    if (mode === 'menu') {
      if (this.rig.mode !== 'showroom') this.driveCam = this.rig.mode;
      this.rig.mode = 'showroom';
    } else this.rig.mode = this.driveCam;
    this.rig.snap();
  }
  private driveCam: 'chase' | 'hood' | 'cinematic' | 'showroom' = 'chase';

  /** Swap the player's vehicle in place (garage). */
  async setVehicle(cfg: VehicleConfig) {
    const ticket = ++this.switching;
    const visual = new VehicleVisual(cfg);
    await visual.load();
    if (ticket !== this.switching) return; // a newer selection won
    const yaw = Math.atan2(-this.vehicle.forward.x, -this.vehicle.forward.z);
    const position = this.vehicle.position.clone();
    position.y += 0.5;
    this.physics.removeRigidBody(this.vehicle.body);
    this.scene.remove(this.visual.root);
    this.vehicle = new Vehicle(this.physics, cfg, { position, yaw });
    this.visual = visual;
    this.scene.add(visual.root);
    this.buildFx();
    this.save.vehicle = cfg.id;
    storeSave(this.save);
    this.party.updateInfo(this.myInfo());
  }

  private buildFx() {
    const q = QUALITY[this.quality];
    if (this.fx) {
      this.scene.remove(this.fx.group);
      this.camera.remove(this.fx.speedLines.mesh);
    }
    this.fx = new VehicleFX(this.vehicle, q);
    this.scene.add(this.fx.group);
    this.camera.add(this.fx.speedLines.mesh);
  }

  private buildQualityDependent() {
    const q = QUALITY[this.quality];
    if (this.fx) {
      this.scene.remove(this.fx.group);
      this.camera.remove(this.fx.speedLines.mesh);
    }
    this.fx = new VehicleFX(this.vehicle, q);
    this.scene.add(this.fx.group);
    this.camera.add(this.fx.speedLines.mesh);
    this.post?.dispose();
    this.post = new PostFX(this.renderer, this.scene, this.camera, q);
  }

  setQuality(level: QualityLevel) {
    this.quality = level;
    saveQuality(level);
    this.buildQualityDependent();
    this.resize();
    this.hud.toast(`GRAPHICS · ${QUALITY[level].label}`);
  }

  private resize() {
    if (!this.post) return;
    const q = QUALITY[this.quality];
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio) * q.resolutionScale);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  /** Advance the game by dt seconds and render. Public so tests can drive it deterministically. */
  frame(dt: number) {
    this.input.update();
    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 5) {
        this.vehicle.step(FIXED_DT, this.mode === 'drive' ? this.input.state : PARKED);
        this.physics.step(this.events);
        this.vehicle.postStep();
        this.events.drainContactForceEvents((e) => {
          if (e.collider1() === this.vehicle.colliderHandle || e.collider2() === this.vehicle.colliderHandle)
            this.vehicle.registerHit(e.totalForceMagnitude());
        });
        this.acc -= FIXED_DT;
        this.time += FIXED_DT;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      this.vehicle.interpolate(this.acc / FIXED_DT);
      this.visual.update(this.vehicle, dt);
      this.rig.update(dt, this.vehicle);
      this.world.update(dt, this.time, this.camera.position, this.vehicle.position);
      this.roadTimer -= dt;
      if (this.roadTimer <= 0 && this.world.roadNameAt) {
        this.roadTimer = 0.4;
        this.hud.setRoadName(this.world.roadNameAt(this.vehicle.position.x, this.vehicle.position.z));
      }
      this.fx.update(dt, this.camera, this.renderer.domElement.height);
      this.party.update(dt, this.vehicle, this.mode === 'drive' && this.input.state.horn);
      this.remotes.update(dt, this.vehicle.position);
      this.hud.remotes = this.remotes.list();
      this.rain.update(dt, this.camera);
      if (this.rain.amount > 0.005 || this.rain.target > 0) {
        this.world.setWet?.(this.rain.amount);
        (this.scene.fog as THREE.FogExp2).density = this.baseFog * (1 + 0.9 * this.rain.amount);
      }
    }
    this.hud.update(dt, this.vehicle);
    this.audio.update(this.vehicle, this.mode === 'drive' && this.input.state.horn, this.paused, this.rain.amount);
    this.music.intensity = this.mode === 'drive' ? Math.min(1, 0.25 + this.vehicle.speed / this.vehicle.config.engine.topSpeed) : 0.15;
    this.post.render(this.paused ? 0 : dt, {
      speed: this.vehicle.speed / this.vehicle.config.engine.topSpeed,
      boosting: this.vehicle.boosting,
      impact: this.vehicle.impact,
    });
    this.autoQuality(dt);
  }

  /** Step down one quality level if we sit below 40 FPS for a few seconds (only once the user hasn't chosen). */
  private autoQuality(dt: number) {
    if (localStorage.getItem('neoncruise.quality')) return;
    this.fastStart += dt;
    if (this.fastStart < 4) return;
    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 150) {
      this.slowFrames = 0;
      const i = QUALITY_ORDER.indexOf(this.quality);
      if (i > 0) {
        this.quality = QUALITY_ORDER[i - 1];
        this.buildQualityDependent();
        this.resize();
        this.hud.toast(`GRAPHICS · ${QUALITY[this.quality].label} (AUTO)`);
      }
    }
  }
}
