import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vehicle } from './Vehicle';
import type { VehicleConfig } from './VehicleConfig';
import { makeTruckArtTexture } from '../effects/textures';

const loader = new GLTFLoader();

/**
 * Renders a vehicle from its .glb. Material naming convention in the model:
 *  Paint* -> body colour, Neon* -> neon colour, Accent* -> accent neon,
 *  Holo* -> animated truck-art hologram, TailLight / HeadLight -> lamps.
 */
export class VehicleVisual {
  readonly root = new THREE.Group();
  private wheelNodes: (THREE.Object3D | null)[] = [];
  private neonMats: THREE.MeshStandardMaterial[] = [];
  private tailMats: THREE.MeshStandardMaterial[] = [];
  private holoMats: THREE.MeshStandardMaterial[] = [];
  private thrusters: THREE.Mesh[] = [];
  private underglow: THREE.PointLight;
  private headlight: THREE.SpotLight;
  private body: THREE.Object3D | null = null;
  private time = 0;
  private boostGlow = 0;

  constructor(readonly config: VehicleConfig) {
    const neon = new THREE.Color(config.colors.neon);
    this.underglow = new THREE.PointLight(neon, 14, 9, 1.8);
    this.underglow.position.set(0, 0.25, 0.1);
    this.root.add(this.underglow);

    this.headlight = new THREE.SpotLight(0xcfe0ff, 160, 80, 0.5, 0.75, 1.7);
    this.headlight.position.set(...config.fx.headlight);
    this.headlight.target.position.set(0, -0.6, -20);
    this.root.add(this.headlight, this.headlight.target);

    // boost thruster flames (procedural so every vehicle gets them from config)
    const flameGeo = new THREE.ConeGeometry(0.13, 1, 12, 1, true);
    flameGeo.translate(0, -0.5, 0);
    flameGeo.rotateX(-Math.PI / 2); // tip points +Z (backwards)
    for (const p of config.fx.thrusters) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(config.colors.accent).multiplyScalar(6),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(flameGeo, mat);
      m.position.set(...p);
      m.scale.set(1, 1, 0.01);
      this.thrusters.push(m);
      this.root.add(m);
    }
  }

  async load(): Promise<void> {
    const c = this.config;
    try {
      const gltf = await loader.loadAsync(c.model);
      const model = gltf.scene;
      const holoTex = makeTruckArtTexture(c.colors.neon, c.colors.accent);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m, i) => {
          const mat = m as THREE.MeshStandardMaterial;
          const n = mat.name;
          mat.envMapIntensity = 1.4;
          if (n.startsWith('Paint')) mat.color.set(c.colors.paint);
          else if (n.startsWith('Neon')) {
            mat.emissive.set(c.colors.neon);
            mat.emissiveIntensity = 4;
            mat.color.set(0x000000);
            this.neonMats.push(mat);
          } else if (n.startsWith('Accent')) {
            mat.emissive.set(c.colors.accent);
            mat.emissiveIntensity = 4;
            mat.color.set(0x000000);
            this.neonMats.push(mat);
          } else if (n.startsWith('TailLight')) {
            mat.emissive.set(0xff1030);
            mat.emissiveIntensity = 3;
            this.tailMats.push(mat);
          } else if (n.startsWith('HeadLight')) {
            mat.emissive.set(0xeaf4ff);
            mat.emissiveIntensity = 6;
          } else if (n.startsWith('Holo')) {
            const hm = new THREE.MeshStandardMaterial({
              name: n,
              color: 0x000000,
              emissive: 0xffffff,
              emissiveMap: holoTex,
              emissiveIntensity: 1.6,
              roughness: 0.3,
              metalness: 0.2,
              side: THREE.DoubleSide,
            });
            this.holoMats.push(hm);
            if (Array.isArray(mesh.material)) mesh.material[i] = hm;
            else mesh.material = hm;
          }
        });
      });
      this.body = model.getObjectByName('body') ?? null;
      this.wheelNodes = c.wheels.map((w) => (w.node ? model.getObjectByName(w.node) ?? null : null));
      for (const w of this.wheelNodes) if (w) w.rotation.order = 'YXZ';
      this.root.add(model);
    } catch (err) {
      console.warn(`[vehicle] model ${c.model} failed to load, using placeholder`, err);
      const [hx, hy, hz] = c.chassis.halfExtents;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
        new THREE.MeshStandardMaterial({ color: c.colors.paint, metalness: 0.6, roughness: 0.3 }),
      );
      box.position.set(...c.chassis.center);
      this.root.add(box);
    }
  }

  update(v: Vehicle, dt: number) {
    this.time += dt;
    this.root.position.copy(v.position);
    this.root.quaternion.copy(v.quaternion);

    const c = this.config;
    for (let i = 0; i < c.wheels.length; i++) {
      const node = this.wheelNodes[i];
      if (!node) continue;
      const ws = v.wheels[i];
      const wc = c.wheels[i];
      node.position.set(wc.visualX ?? wc.pos[0], ws.localY, wc.pos[2]);
      node.rotation.y = ws.steerAngle;
      node.rotation.x = -ws.spin;
    }

    // subtle visual body lean on top of the physics for extra character
    if (this.body) {
      const lean = THREE.MathUtils.clamp(v.steer * Math.min(1, v.speed / 25) * 0.05, -0.07, 0.07);
      this.body.rotation.z += (lean - this.body.rotation.z) * Math.min(1, dt * 6);
    }

    const target = v.boosting ? 1 : 0;
    this.boostGlow += (target - this.boostGlow) * Math.min(1, dt * (target ? 14 : 4));
    const pulse = 1 + 0.08 * Math.sin(this.time * 9);
    for (const m of this.neonMats) m.emissiveIntensity = (3.6 + this.boostGlow * 6) * pulse;
    for (const m of this.tailMats) m.emissiveIntensity = v.braking ? 12 : 3 + this.boostGlow * 3;
    for (const m of this.holoMats) m.emissiveIntensity = 1.4 + 0.5 * Math.sin(this.time * 2.3) + this.boostGlow * 1.5;
    this.underglow.intensity = (12 + this.boostGlow * 30) * pulse;

    const throttleFlame = v.throttle * 0.12 * Math.min(1, v.speed / 20);
    for (let i = 0; i < this.thrusters.length; i++) {
      const f = this.thrusters[i];
      const len = this.boostGlow * (1.5 + 0.35 * Math.sin(this.time * 60 + i * 2)) + throttleFlame;
      f.scale.set(1 + this.boostGlow * 0.6, 1 + this.boostGlow * 0.6, Math.max(0.01, len));
      f.visible = len > 0.02;
    }
  }

  setColors(paint: number, neon: number, accent: number) {
    this.config.colors.paint = paint;
    this.config.colors.neon = neon;
    this.config.colors.accent = accent;
    this.underglow.color.set(neon);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat.name?.startsWith('Paint')) mat.color.set(paint);
        else if (mat.name?.startsWith('Neon')) mat.emissive.set(neon);
        else if (mat.name?.startsWith('Accent')) mat.emissive.set(accent);
      }
    });
  }
}
