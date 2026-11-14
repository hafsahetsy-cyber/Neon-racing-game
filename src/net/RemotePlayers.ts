import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';
import type { VehicleConfig } from '../vehicles/VehicleConfig';
import { VehicleVisual } from '../vehicles/VehicleVisual';
import { vehicleById } from '../vehicles/registry';
import { FLAG_BOOST, FLAG_BRAKE, FLAG_HORN, type Snapshot } from './Party';
import type { PlayerInfo } from './Transport';

/** How far in the past remote cars are drawn, so there are always two snapshots to blend between. */
const DELAY = 0.16;

interface Snap {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  v: THREE.Vector3;
  steer: number;
  flags: number;
}

class Remote {
  visual: VehicleVisual | null = null;
  config: VehicleConfig;
  key = '';
  snaps: Snap[] = [];
  body: RAPIER.RigidBody;
  label: THREE.Sprite;
  bubble: THREE.Sprite;
  bubbleTime = 0;
  horn = false;
  /** Race progress: checkpoints passed and metres to the next one. */
  race = { cp: 0, dist: 9999 };
  /** The subset of Vehicle that VehicleVisual reads. */
  state: {
    position: THREE.Vector3; quaternion: THREE.Quaternion; steer: number; speed: number; forwardSpeed: number;
    boosting: boolean; braking: boolean; throttle: number;
    wheels: { localY: number; steerAngle: number; spin: number }[];
  };
  constructor(public info: PlayerInfo, world: RAPIER.World, readonly group: THREE.Group) {
    this.config = vehicleById(info.vehicle);
    this.state = {
      position: new THREE.Vector3(0, -100, 0), quaternion: new THREE.Quaternion(), steer: 0, speed: 0, forwardSpeed: 0,
      boosting: false, braking: false, throttle: 0, wheels: [],
    };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
    this.label = makeTextSprite(info.name, '#' + info.neon.toString(16).padStart(6, '0'));
    this.bubble = makeTextSprite('', '#ffffff');
    this.bubble.visible = false;
    group.add(this.label, this.bubble);
  }
}

function makeTextSprite(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(5, 0.94, 1);
  s.renderOrder = 9;
  drawText(s, text, color);
  return s;
}

function drawText(s: THREE.Sprite, text: string, color: string) {
  const tex = s.material.map as THREE.CanvasTexture;
  const c = tex.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.font = '700 46px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.min(500, g.measureText(text).width + 44);
  g.fillStyle = 'rgba(5,3,12,0.72)';
  g.fillRect(256 - w / 2, 14, w, 68);
  g.fillStyle = color;
  g.fillRect(256 - w / 2, 78, w, 4);
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.fillStyle = '#ffffff';
  g.fillText(text, 256, 50, 470);
  g.shadowBlur = 0;
  tex.needsUpdate = true;
}

/** Draws and collides the other players in the party, smoothing over network jitter. */
export class RemotePlayers {
  readonly group = new THREE.Group();
  private remotes = new Map<string, Remote>();
  private now = 0;
  private tmpQ = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  onHorn: (distance: number) => void = () => {};

  constructor(private world: RAPIER.World, private selfId: string) {}

  /** Positions for the mini-map. */
  list() {
    const out: { x: number; z: number; color: number; name: string }[] = [];
    for (const r of this.remotes.values())
      if (r.snaps.length) out.push({ x: r.state.position.x, z: r.state.position.z, color: r.info.neon, name: r.info.name });
    return out;
  }

  setRoster(players: PlayerInfo[]) {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, r] of this.remotes) if (!ids.has(id)) this.remove(id, r);
    for (const p of players) {
      if (p.id === this.selfId) continue;
      let r = this.remotes.get(p.id);
      if (!r) this.remotes.set(p.id, (r = new Remote(p, this.world, this.group)));
      const key = `${p.vehicle}|${p.paint}|${p.neon}|${p.accent}`;
      if (r.info.name !== p.name) drawText(r.label, p.name, '#' + p.neon.toString(16).padStart(6, '0'));
      r.info = p;
      if (key !== r.key) void this.buildVisual(r, key);
    }
  }

  private async buildVisual(r: Remote, key: string) {
    r.key = key;
    const base = vehicleById(r.info.vehicle);
    const cfg: VehicleConfig = { ...base, colors: { paint: r.info.paint, neon: r.info.neon, accent: r.info.accent } };
    const visual = new VehicleVisual(cfg, false);
    await visual.load();
    if (r.key !== key || !this.remotes.has(r.info.id)) return; // changed again, or left, while loading
    if (r.visual) this.group.remove(r.visual.root);
    r.visual = visual;
    r.config = cfg;
    r.state.wheels = cfg.wheels.map((w) => ({ localY: w.pos[1], steerAngle: 0, spin: 0 }));
    visual.root.visible = r.snaps.length > 0;
    this.group.add(visual.root);
    // collider matching the new vehicle
    for (let i = r.body.numColliders() - 1; i >= 0; i--) this.world.removeCollider(r.body.collider(i), false);
    const [hx, hy, hz] = cfg.chassis.halfExtents;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(...cfg.chassis.center).setFriction(0.3), r.body);
  }

  private remove(id: string, r: Remote) {
    if (r.visual) this.group.remove(r.visual.root);
    this.group.remove(r.label, r.bubble);
    this.world.removeRigidBody(r.body);
    this.remotes.delete(id);
  }

  clear() {
    for (const [id, r] of [...this.remotes]) this.remove(id, r);
  }

  push(from: string, s: Snapshot) {
    const r = this.remotes.get(from);
    if (!r || s.length < 12) return;
    r.snaps.push({
      t: this.now,
      p: new THREE.Vector3(s[0], s[1], s[2]),
      q: new THREE.Quaternion(s[3], s[4], s[5], s[6]).normalize(),
      v: new THREE.Vector3(s[7], s[8], s[9]),
      steer: s[10],
      flags: s[11],
    });
    if (r.snaps.length > 12) r.snaps.shift();
    if (s.length >= 14) r.race = { cp: s[12], dist: s[13] };
    if (r.visual) r.visual.root.visible = true;
  }

  raceOf(id: string) {
    return this.remotes.get(id)?.race;
  }

  resetRace() {
    for (const r of this.remotes.values()) r.race = { cp: 0, dist: 9999 };
  }

  say(from: string, text: string) {
    const r = this.remotes.get(from);
    if (!r) return;
    drawText(r.bubble, text.slice(0, 24), '#ffa630');
    r.bubble.visible = true;
    r.bubbleTime = 4;
  }

  update(dt: number, listener: THREE.Vector3) {
    this.now += dt;
    const t = this.now - DELAY;
    for (const r of this.remotes.values()) {
      const sn = r.snaps;
      if (!sn.length) continue;
      const st = r.state;
      // find the pair of snapshots straddling the render time
      let i = sn.length - 1;
      while (i > 0 && sn[i].t > t) i--;
      const a = sn[i];
      const b = sn[Math.min(i + 1, sn.length - 1)];
      if (b.t > a.t && t >= a.t) {
        const k = Math.min(1, (t - a.t) / (b.t - a.t));
        st.position.lerpVectors(a.p, b.p, k);
        st.quaternion.slerpQuaternions(a.q, b.q, k);
      } else {
        // newest data is older than the render time: coast on its velocity for a moment
        const ahead = Math.min(0.35, Math.max(0, t - a.t));
        st.position.copy(a.p).addScaledVector(a.v, ahead);
        st.quaternion.copy(a.q);
      }
      const latest = sn[sn.length - 1];
      st.speed = latest.v.length();
      this.fwd.set(0, 0, -1).applyQuaternion(st.quaternion);
      st.forwardSpeed = latest.v.dot(this.fwd);
      st.steer = latest.steer;
      st.boosting = !!(latest.flags & FLAG_BOOST);
      st.braking = !!(latest.flags & FLAG_BRAKE);
      st.throttle = st.speed > 1 && !st.braking ? 0.6 : 0;
      const lock = THREE.MathUtils.lerp(r.config.steer.maxAngle, r.config.steer.minAngle, Math.min(1, st.speed / r.config.engine.topSpeed));
      r.config.wheels.forEach((w, wi) => {
        const ws = st.wheels[wi];
        if (!ws) return;
        ws.steerAngle = w.steer ? -st.steer * lock : 0;
        ws.spin += (st.forwardSpeed / w.radius) * dt;
      });
      r.visual?.update(st as unknown as Vehicle, dt);
      r.body.setNextKinematicTranslation(st.position);
      r.body.setNextKinematicRotation(this.tmpQ.copy(st.quaternion));
      const top = r.config.chassis.center[1] + r.config.chassis.halfExtents[1];
      r.label.position.copy(st.position).setY(st.position.y + top + 1.5);
      if (r.bubbleTime > 0) {
        r.bubbleTime -= dt;
        r.bubble.position.copy(st.position).setY(st.position.y + top + 2.6);
        r.bubble.material.opacity = Math.min(1, r.bubbleTime);
        if (r.bubbleTime <= 0) r.bubble.visible = false;
      }
      const horn = !!(latest.flags & FLAG_HORN) && this.now - latest.t < 0.5;
      if (horn && !r.horn) this.onHorn(st.position.distanceTo(listener));
      r.horn = horn;
    }
  }
}
