import * as THREE from 'three';

/**
 * Rain streaks in a box that follows the camera. Drops live in world space, so driving
 * fast makes the rain rake back towards the lens.
 */
export class Rain {
  readonly mesh: THREE.LineSegments;
  /** 0 = dry, 1 = downpour. Eases towards `target`. */
  amount = 0;
  target = 0;
  private drops: Float32Array;
  private pos: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.LineBasicMaterial;
  private lastCam = new THREE.Vector3();
  private camVel = new THREE.Vector3();
  private readonly BOX = new THREE.Vector3(44, 26, 44);
  private readonly fall = new THREE.Vector3(-3, -30, 1.5);

  constructor(private n: number) {
    this.drops = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      this.drops[i] = Math.random() * this.BOX.x;
      this.drops[i + 1] = Math.random() * this.BOX.y;
      this.drops[i + 2] = Math.random() * this.BOX.z;
    }
    this.pos = new Float32Array(n * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.55, 0.7, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.LineSegments(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  update(dt: number, camera: THREE.Camera) {
    this.amount += (this.target - this.amount) * Math.min(1, dt * 0.8);
    if (this.amount < 0.01) {
      this.mesh.visible = false;
      this.lastCam.copy(camera.position);
      return;
    }
    this.mesh.visible = true;
    this.mat.opacity = 0.34 * this.amount;
    if (dt > 0) this.camVel.copy(camera.position).sub(this.lastCam).divideScalar(dt);
    if (this.camVel.lengthSq() > 200 * 200) this.camVel.set(0, 0, 0); // teleport / reset
    this.lastCam.copy(camera.position);
    const { x: bx, y: by, z: bz } = this.BOX;
    const ox = camera.position.x - bx / 2, oy = camera.position.y - by * 0.35, oz = camera.position.z - bz / 2;
    const f = this.fall;
    // streak length follows the drop's velocity relative to the camera
    const sx = (f.x - this.camVel.x) * 0.028, sy = (f.y - this.camVel.y) * 0.028, sz = (f.z - this.camVel.z) * 0.028;
    const active = Math.floor(this.n * Math.min(1, this.amount + 0.15));
    const d = this.drops;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      d[k] += f.x * dt;
      d[k + 1] += f.y * dt;
      d[k + 2] += f.z * dt;
      // wrap into the camera-centred box
      const x = ox + ((((d[k] - ox) % bx) + bx) % bx);
      const y = oy + ((((d[k + 1] - oy) % by) + by) % by);
      const z = oz + ((((d[k + 2] - oz) % bz) + bz) % bz);
      const j = i * 6;
      if (i >= active) {
        this.pos[j] = this.pos[j + 3] = 0;
        this.pos[j + 1] = this.pos[j + 4] = -999;
        this.pos[j + 2] = this.pos[j + 5] = 0;
        continue;
      }
      this.pos[j] = x;
      this.pos[j + 1] = y;
      this.pos[j + 2] = z;
      this.pos[j + 3] = x - sx;
      this.pos[j + 4] = y - sy;
      this.pos[j + 5] = z - sz;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
