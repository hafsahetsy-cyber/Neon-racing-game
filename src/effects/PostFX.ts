import {
  BlendFunction, BloomEffect, BrightnessContrastEffect, Effect, EffectAttribute, EffectComposer, EffectPass, HueSaturationEffect,
  NoiseEffect, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import type { QualitySettings } from '../core/Quality';

const warpFragment = /* glsl */ `
uniform float uBlur;
uniform float uAberration;
uniform float uDistortion;
uniform float uPulse;
uniform float uShimmer;
uniform float uTime;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - 0.5;
  // heat haze: the air ripples in a band along the horizon
  float band = exp(-pow((uv.y - 0.56) * 7.0, 2.0));
  c.x += (sin(uv.y * 150.0 + uTime * 5.0) + sin(uv.y * 61.0 - uTime * 3.1)) * 0.0011 * uShimmer * band;
  float r2 = dot(c, c);
  // lens distortion: edges stretch outward as speed builds (plus a punch on boost)
  float k = uDistortion + uPulse * 0.35;
  vec2 dir = c * (1.0 - k * r2);
  float edge = smoothstep(0.04, 0.55, length(c));
  float blur = (uBlur + uPulse * 0.12) * edge;
  float ca = (uAberration + uPulse * 0.02) * edge;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < WARP_SAMPLES; i++) {
    float t = float(i) / max(1.0, float(WARP_SAMPLES - 1));
    float s = 1.0 - blur * t;
    acc.r += texture2D(inputBuffer, 0.5 + dir * s * (1.0 + ca)).r;
    acc.g += texture2D(inputBuffer, 0.5 + dir * s).g;
    acc.b += texture2D(inputBuffer, 0.5 + dir * s * (1.0 - ca)).b;
  }
  vec3 col = acc / float(WARP_SAMPLES);
  col += vec3(0.25, 0.6, 1.0) * uPulse * 0.25 * edge;
  outputColor = vec4(col, inputColor.a);
}
`;

/** Radial blur + chromatic aberration + lens distortion in one pass, all driven by speed. */
class SpeedWarpEffect extends Effect {
  constructor(samples: number) {
    super('SpeedWarpEffect', warpFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      defines: new Map([['WARP_SAMPLES', String(samples)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uBlur', new THREE.Uniform(0)],
        ['uAberration', new THREE.Uniform(0)],
        ['uDistortion', new THREE.Uniform(0)],
        ['uPulse', new THREE.Uniform(0)],
        ['uShimmer', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    });
  }
}

export interface SpeedFxState {
  /** 0..~1.4 — speed relative to the vehicle's top speed. */
  speed: number;
  boosting: boolean;
  impact: number;
  /** 0..1 heat haze along the horizon (hot cities). */
  shimmer?: number;
}

export class PostFX {
  private composer: EffectComposer;
  private warp: SpeedWarpEffect | null = null;
  private bloom: BloomEffect | null = null;
  private vignette: VignetteEffect;
  private pulse = 0;
  private wasBoosting = false;
  private smoothed = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    q: QualitySettings,
    /** Per-city look: saturation and contrast in -1..1, and a multiplier on bloom. */
    private grade: { saturation: number; contrast: number; brightness?: number; bloom: number } = { saturation: 0, contrast: 0, bloom: 1 },
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: Math.min(q.msaa, renderer.capabilities.maxSamples),
    });
    this.composer.addPass(new RenderPass(scene, camera));

    if (q.bloom) {
      this.bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.72,
        luminanceSmoothing: 0.25,
        intensity: 1.15,
        radius: 0.78,
        levels: 7,
      });
      this.composer.addPass(new EffectPass(camera, this.bloom));
    }

    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });
    const final: Effect[] = [];
    if (q.warpSamples > 1) {
      this.warp = new SpeedWarpEffect(q.warpSamples);
      final.push(this.warp);
    }
    final.push(this.vignette);
    if (q.grain) {
      const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
      noise.blendMode.opacity.value = 0.22;
      final.push(noise);
    }
    final.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    if (grade.saturation !== 0) final.push(new HueSaturationEffect({ saturation: grade.saturation }));
    if (grade.contrast !== 0 || grade.brightness) final.push(new BrightnessContrastEffect({ contrast: grade.contrast, brightness: grade.brightness ?? 0 }));
    this.composer.addPass(new EffectPass(camera, ...final));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(dt: number, s: SpeedFxState) {
    if (s.boosting && !this.wasBoosting) this.pulse = 1;
    this.wasBoosting = s.boosting;
    this.pulse = Math.max(0, this.pulse - dt * 2.4);

    const target = THREE.MathUtils.smoothstep(s.speed, 0.35, 1.15) + (s.boosting ? 0.35 : 0);
    this.smoothed += (target - this.smoothed) * Math.min(1, dt * 4);
    const k = this.smoothed;
    if (this.warp) {
      const u = this.warp.uniforms;
      u.get('uBlur')!.value = 0.075 * k * k;
      u.get('uAberration')!.value = 0.0035 * k + s.impact * 0.006;
      u.get('uDistortion')!.value = 0.16 * k;
      u.get('uPulse')!.value = this.pulse * this.pulse;
      u.get('uShimmer')!.value = s.shimmer ?? 0;
      u.get('uTime')!.value += dt;
    }
    if (this.bloom) this.bloom.intensity = (1.15 + 0.5 * k) * this.grade.bloom + this.pulse * 1.2;
    this.vignette.darkness = 0.55 + 0.25 * k;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
