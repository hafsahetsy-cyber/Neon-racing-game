import * as THREE from 'three';

export interface ParticleOpts {
  max: number;
  texture: THREE.Texture;
  additive: boolean;
  gravity: number;
  drag: number;
  /** Size multiplier over lifetime: size * (1 + grow * t). */
  grow: number;
}

/** Pooled CPU particle system rendered as one Points draw call. */
export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private baseAlpha: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor(private o: ParticleOpts) {
    const n = o.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.baseSize = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: o.texture }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec4 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r * vColor.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }
      `,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewport(heightPx: number, fovDeg: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value =
      heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, alpha: number, size: number, life: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.o.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b, alpha], i * 4);
    this.baseSize[i] = size;
    this.baseAlpha[i] = alpha;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number) {
    const { pos, vel, col, life, maxLife, size, baseSize, baseAlpha } = this;
    const drag = Math.exp(-this.o.drag * dt);
    for (let i = 0; i < this.o.max; i++) {
      if (life[i] <= 0) {
        if (size[i] !== 0) size[i] = 0;
        continue;
      }
      life[i] -= dt;
      const t = 1 - Math.max(0, life[i]) / maxLife[i];
      vel[i * 3 + 1] -= this.o.gravity * dt;
      vel[i * 3] *= drag;
      vel[i * 3 + 1] *= drag;
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (this.o.gravity > 0 && pos[i * 3 + 1] < 0.03) {
        pos[i * 3 + 1] = 0.03;
        vel[i * 3 + 1] *= -0.4;
      }
      size[i] = baseSize[i] * (1 + this.o.grow * t);
      col[i * 4 + 3] = baseAlpha[i] * (1 - t) * Math.min(1, t * 12);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}
