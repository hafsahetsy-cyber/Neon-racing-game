import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EngineAudio } from '../audio/EngineAudio';
import { Music } from '../audio/Music';
import { Party, makeCode, normaliseCode } from '../net/Party';
import { RemotePlayers } from '../net/RemotePlayers';
import { Race, type Standing, formatTime, rank } from '../race/Race';
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
import { CITIES, cityByCodePrefix, cityById } from '../world/cities';
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
  /** The city being played: ?city= in the address wins, then the saved choice. */
  city = cityById(null);
  readonly save = loadSave();
  menu!: Menu;
  readonly party = new Party();
  remotes!: RemotePlayers;
  readonly race = new Race();
  private finishes = new Map<string, number>();
  private newBest = false;
  private lastTick = 0;
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
    const params = new URLSearchParams(location.search);
    const invited = cityByCodePrefix((params.get('party') ?? '').toUpperCase().slice(0, 3));
    this.city = invited ?? cityById(params.get('city') ?? this.save.city);
    this.music.style = this.city.music;
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
      createParty: () => this.party.join(makeCode(this.city.codePrefix), this.myInfo()),
      cities: () => CITIES.map((c) => ({ id: c.id, name: c.name, tagline: c.tagline, blurb: c.blurb, current: c === this.city })),
      selectCity: (id) => {
        if (id === this.city.id) return this.menu.show('title');
        this.gotoCity(id);
      },
      joinParty: async (raw) => {
        const code = normaliseCode(raw);
        if (!code) throw new Error('Codes look like KHI-7Q2');
        // a code from another city: go there, with the code ready to join
        const other = cityByCodePrefix(code.slice(0, 3));
        if (other && other !== this.city) {
          this.gotoCity(other.id, code);
          throw new Error(`Travelling to ${other.name}…`);
        }
        await this.party.join(code, this.myInfo());
      },
      leaveParty: () => this.party.leave(),
      race: () => {
        const routes = this.world.routes ?? [];
        const veh = this.vehicle.config.id;
        const ranked = rank(this.standings());
        return {
          routes: routes.map((r) => ({ ...r, best: this.save.best[`${r.name}|${veh}`] ? formatTime(this.save.best[`${r.name}|${veh}`]) : undefined })),
          blocked: this.party.connected && !this.party.isHost ? 'Only the party host can start a race.' : '',
          routeName: this.race.route?.name ?? '',
          results: ranked.map((s, i) => ({ place: i + 1, name: s.name, time: s.time !== undefined ? formatTime(s.time) : 'still racing', self: s.self })),
          newBest: this.newBest,
          active: this.race.active,
        };
      },
      startRace: (i) => {
        if (this.party.connected) {
          if (!this.party.isHost) return;
          this.party.send('race', { r: i });
        }
        this.beginRace(i);
      },
      endRace: () => {
        this.race.stop();
        this.hud.setRace(null);
        this.hud.raceTarget = null;
      },
      savePhoto: () => this.savePhoto(),
      exitPhoto: () => this.setPhoto(false),
      raining: () => this.rain.target > 0,
      setRain: (on) => (this.rain.target = on ? 1 : 0),
    });

    this.input.on((a) => {
      if (a === 'photo' && (this.photo.on || (this.mode === 'drive' && !this.race.active))) return this.setPhoto(!this.photo.on);
      if (a === 'pause' && this.photo.on) return this.setPhoto(false);
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

    this.scene.environment = makeNeonEnvironment(this.renderer, this.city.neon, new THREE.Color(this.city.sky.zenith).lerp(new THREE.Color(this.city.fog.color), 0.35).getHex());
    // ?world=test loads the Phase 1 proving ground instead of the city
    const testTrack = new URLSearchParams(location.search).get('world') === 'test';
    this.world = testTrack ? buildTestTrack(this.physics, q) : await buildCity(this.physics, q, this.city);
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

    this.bindPhotoControls();

    // ---- race
    this.scene.add(this.race.group);
    this.party.onEvent = (event, from, payload) => {
      if (event === 'race' && from === this.party.host?.id) this.beginRace((payload as { r: number }).r);
      else if (event === 'fin') {
        this.finishes.set(from, (payload as { t: number }).t);
        this.menu.refresh();
      }
    };
    this.race.onEvent = (e, race) => {
      if (e === 'go') this.audio.blip(880, 0.5);
      else if (e === 'checkpoint') {
        this.audio.blip(660);
        this.hud.toast(`CHECKPOINT ${race.cp}/${race.route!.cps.length}`);
      } else {
        this.audio.blip(990, 0.6);
        const key = `${race.route!.name}|${this.vehicle.config.id}`;
        const prev = this.save.best[key];
        this.newBest = !prev || race.finishTime < prev;
        if (this.newBest) {
          this.save.best[key] = race.finishTime;
          storeSave(this.save);
        }
        this.finishes.set(this.party.id, race.finishTime);
        this.party.send('fin', { t: race.finishTime });
        this.setMode('menu');
        this.menu.show('results');
      }
    };
    const invite = normaliseCode(new URLSearchParams(location.search).get('party') ?? '');
    if (invite) {
      this.menu.pendingCode = invite;
      this.menu.show('party');
    }
  }

  /** Start a race for this player (the host has already told everyone else). */
  private beginRace(index: number) {
    const route = this.world.routes?.[index];
    if (!route) return;
    const ids = this.party.connected ? this.party.players.map((p) => p.id).sort() : [this.party.id];
    this.finishes.clear();
    this.remotes.resetRace();
    this.newBest = false;
    this.lastTick = 0;
    this.race.start(route, index, this.vehicle, Math.max(0, ids.indexOf(this.party.id)));
    this.menu.show('none');
    this.setMode('drive');
    this.hud.toast(route.name);
  }

  private standings(): Standing[] {
    const self: Standing = {
      id: this.party.id, name: this.save.name, cp: this.race.cp, dist: this.race.distToNext,
      time: this.finishes.get(this.party.id), self: true,
    };
    const others = this.party.players
      .filter((p) => p.id !== this.party.id)
      .map((p): Standing => {
        const r = this.remotes.raceOf(p.id) ?? { cp: 0, dist: 9999 };
        return { id: p.id, name: p.name, cp: r.cp, dist: r.dist, time: this.finishes.get(p.id), self: false };
      });
    return [self, ...others];
  }

  private updateRaceHud() {
    const race = this.race;
    this.hud.raceTarget = race.target();
    if (!race.active || !race.route) return this.hud.setRace(null);
    const ranked = rank(this.standings());
    let countdown = '';
    if (race.phase === 'countdown') {
      const n = Math.ceil(race.clock);
      countdown = n <= 3 ? String(n) : '';
      if (n <= 3 && n !== this.lastTick) {
        this.lastTick = n;
        this.audio.blip(440);
      }
    } else if (race.clock < 1) countdown = 'GO!';
    this.hud.setRace({
      pos: ranked.findIndex((s) => s.self) + 1,
      of: ranked.length,
      cp: race.cp,
      cps: race.route.cps.length,
      time: race.phase === 'racing' ? formatTime(race.clock) : '0:00.00',
      countdown,
      list: ranked.length > 1 ? ranked.slice(0, 8).map((s, i) => `${i + 1}  ${s.name}`) : [],
    });
  }

  // ---------------------------------------------------------------- photo mode
  private photo = { on: false, yaw: 0.6, pitch: 0.22, dist: 7.5, drag: false, x: 0, y: 0 };

  private bindPhotoControls() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (!this.photo.on) return;
      this.photo.drag = true;
      this.photo.x = e.clientX;
      this.photo.y = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.photo.on || !this.photo.drag) return;
      this.photo.yaw -= (e.clientX - this.photo.x) * 0.006;
      this.photo.pitch = THREE.MathUtils.clamp(this.photo.pitch + (e.clientY - this.photo.y) * 0.004, -0.05, 1.35);
      this.photo.x = e.clientX;
      this.photo.y = e.clientY;
    });
    const end = () => (this.photo.drag = false);
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      if (!this.photo.on) return;
      e.preventDefault();
      this.photo.dist = THREE.MathUtils.clamp(this.photo.dist * (e.deltaY > 0 ? 1.1 : 0.9), 2.5, 60);
    }, { passive: false });
  }

  /** Freeze the world and hand the camera to the player. */
  setPhoto(on: boolean) {
    this.photo.on = on;
    this.paused = on;
    this.hud.setVisible(!on && this.mode === 'drive');
    if (on) {
      // start from where the chase camera is, so the framing does not jump
      const d = this.camera.position.clone().sub(this.vehicle.position);
      this.photo.dist = THREE.MathUtils.clamp(d.length(), 4, 14);
      this.photo.yaw = Math.atan2(d.x, d.z);
      this.photo.pitch = THREE.MathUtils.clamp(Math.asin(d.y / d.length()), 0.05, 1.2);
      this.menu.show('photo');
    } else {
      this.menu.show('none');
      this.rig.snap();
    }
  }

  private aimPhotoCamera() {
    const p = this.photo;
    const target = this.vehicle.position.clone();
    target.y += 0.9;
    const cp = Math.cos(p.pitch);
    this.camera.position.set(
      target.x + Math.sin(p.yaw) * cp * p.dist,
      Math.max(0.3, target.y + Math.sin(p.pitch) * p.dist),
      target.z + Math.cos(p.yaw) * cp * p.dist,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 48;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);
  }

  /** Render one clean frame and download it as a PNG. */
  savePhoto() {
    this.frame(0);
    const a = document.createElement('a');
    a.href = this.canvas.toDataURL('image/png');
    a.download = `neon-cruise-${Date.now()}.png`;
    a.click();
  }

  /** Cities are loaded fresh: save the choice and reload the page into it. */
  private gotoCity(id: string, partyCode = '') {
    this.save.city = id;
    storeSave(this.save);
    this.party.leave();
    const q = new URLSearchParams();
    q.set('city', id);
    if (partyCode) q.set('party', partyCode);
    location.search = q.toString();
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
        // loose surfaces (sand, shallow water) ease in rather than snapping
        const grip = this.world.gripAt?.(this.vehicle.position.x, this.vehicle.position.z) ?? 1;
        this.vehicle.gripScale += (grip - this.vehicle.gripScale) * 0.12;
        this.vehicle.step(FIXED_DT, this.mode === 'drive' && !this.race.holding ? this.input.state : PARKED);
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
      this.fx.spray = this.world.sprayAt?.(this.vehicle.position.x, this.vehicle.position.z);
      this.fx.update(dt, this.camera, this.renderer.domElement.height);
      this.race.update(dt, this.vehicle);
      this.updateRaceHud();
      this.party.update(
        dt, this.vehicle, this.mode === 'drive' && this.input.state.horn,
        this.race.phase !== 'idle' ? [this.race.cp, Math.round(this.race.distToNext)] : undefined,
      );
      this.remotes.update(dt, this.vehicle.position);
      this.hud.remotes = this.remotes.list();
      this.rain.update(dt, this.camera);
      if (this.rain.amount > 0.005 || this.rain.target > 0) this.world.setWet?.(this.rain.amount);
      (this.scene.fog as THREE.FogExp2).density = this.baseFog * (this.world.fogScale ?? 1) * (1 + 0.9 * this.rain.amount);
    }
    if (this.photo.on) this.aimPhotoCamera();
    this.hud.update(dt, this.vehicle);
    this.audio.update(this.vehicle, this.mode === 'drive' && this.input.state.horn, this.paused, this.rain.amount);
    this.music.intensity = this.mode === 'drive' ? Math.min(1, 0.25 + this.vehicle.speed / this.vehicle.config.engine.topSpeed) : 0.15;
    // photo mode gets a clean frame: no speed blur frozen into the picture
    this.post.render(this.photo.on ? 1 : this.paused ? 0 : dt, {
      speed: this.photo.on ? 0 : this.vehicle.speed / this.vehicle.config.engine.topSpeed,
      boosting: !this.photo.on && this.vehicle.boosting,
      impact: this.vehicle.impact,
      shimmer: this.photo.on ? 0 : this.city.atmosphere.shimmer,
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
