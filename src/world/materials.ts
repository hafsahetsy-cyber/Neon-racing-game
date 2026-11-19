import * as THREE from 'three';

/**
 * Instanced tower material: procedural lit windows computed in world space, so one
 * unit box can be scaled to any size without stretching. Reused by every city.
 */
export function makeTowerMaterial(fogColor: THREE.Color, fogDensity: number, ambient = new THREE.Color(0)) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFogColor: { value: fogColor },
      uFogDensity: { value: fogDensity },
      uTime: { value: 0 },
      uAmbient: { value: ambient },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vTint;
      varying float vSeed;
      varying float vDepth;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vTint = instanceColor;
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        vec4 mv = viewMatrix * wp;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uTime;
      uniform vec3 uAmbient;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vTint;
      varying float vSeed;
      varying float vDepth;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 col = vec3(0.012, 0.012, 0.022) + uAmbient * (0.5 + 0.5 * abs(n.x));
        if (abs(n.y) < 0.5) {
          float h = abs(n.x) > 0.5 ? vWorld.z : vWorld.x;
          vec2 g = vec2(h / 4.0, vWorld.y / 4.5);
          vec2 cell = floor(g);
          vec2 f = fract(g);
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.78);
          float r = hash(cell + vSeed * 91.0);
          float lit = step(0.62, r);
          vec3 wcol = mix(vTint, vec3(1.0, 0.82, 0.55), step(0.9, r));
          col += win * lit * wcol * (0.9 + 1.6 * fract(r * 7.0));
          // glowing floor bands every so often
          float band = step(0.93, hash(vec2(cell.y, vSeed * 17.0))) * step(f.y, 0.2);
          col += band * vTint * 2.2;
          // vertical neon edge
          float edge = step(0.92, hash(vec2(vSeed * 5.0, 3.0))) * step(0.5, hash(vec2(cell.x, vSeed)))
                     * step(f.x, 0.08);
          col += edge * vTint * 2.5;
        }
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Night sky dome: horizon glow, stars, and a faint aurora band. */
export function makeSky(horizon: THREE.Color, zenith: THREE.Color) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uHorizon: { value: horizon }, uZenith: { value: zenith }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
        // hot band hugging the horizon (city light pollution)
        col += uHorizon * 1.6 * exp(-h * 9.0);
        col += vec3(1.0, 0.25, 0.55) * 0.35 * exp(-h * 22.0);
        // stars
        vec3 c = floor(d * 240.0);
        float s = step(0.9975, hash(c));
        col += s * vec3(0.9, 0.95, 1.0) * smoothstep(0.08, 0.5, h) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(c + 1.0) * 40.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.scale.setScalar(2000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** Small emissive scene baked to an env map so chrome and wet tarmac pick up neon reflections. */
/** `neon` = the city's colours, so chrome and wet tarmac reflect the right city. */
export function makeNeonEnvironment(renderer: THREE.WebGLRenderer, neon: number[] = [0x00f0ff, 0xff2bd6, 0x7a5cff], sky = 0x05030c, glow = 1): THREE.Texture {
  const [A, B, C] = [neon[0], neon[1 % neon.length], neon[2 % neon.length]];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  const add = (color: number, intensity: number, pos: [number, number, number], size: [number, number, number]) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity * glow) }),
    );
    m.position.set(...pos);
    scene.add(m);
  };
  add(A, 6, [-18, 6, -4], [1, 10, 14]);
  add(B, 6, [18, 5, 6], [1, 8, 16]);
  add(0xffb347, 4, [0, 4, -20], [16, 3, 1]);
  add(C, 3, [0, 18, 0], [26, 1, 26]);
  add(B, 3, [6, 3, 20], [10, 2, 1]);
  add(A, 2, [-8, 10, 18], [3, 14, 1]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  return tex;
}

/** Sky dome with a three-band gradient, a sun or moon with its glow, and optional stars. */
export function makeAtmosphereSky(o: {
  horizon: THREE.Color; mid: THREE.Color; zenith: THREE.Color; sunDir: THREE.Vector3; sunColor: THREE.Color; sunSize: number; stars: number;
  clouds?: { cover: number; color: THREE.Color };
}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: o.horizon }, uMid: { value: o.mid }, uZenith: { value: o.zenith }, uSunDir: { value: o.sunDir },
      uSunColor: { value: o.sunColor }, uSunSize: { value: o.sunSize }, uStars: { value: o.stars }, uTime: { value: 0 },
      uCloud: { value: o.clouds?.cover ?? 0 }, uCloudColor: { value: o.clouds?.color ?? new THREE.Color(0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon; uniform vec3 uMid; uniform vec3 uZenith; uniform vec3 uSunDir; uniform vec3 uSunColor;
      uniform float uSunSize; uniform float uStars; uniform float uTime;
      uniform float uCloud; uniform vec3 uCloudColor;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float a = 0.5, s = 0.0;
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return s;
      }
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
        col = mix(col, uZenith, smoothstep(0.1, 0.7, h));
        col += uHorizon * 0.9 * exp(-h * 11.0);
        float sd = max(dot(d, uSunDir), 0.0);
        // disc, tight corona, and a wide wash that lights the haze around it
        col += uSunColor * (smoothstep(1.0 - 0.0006 * uSunSize, 1.0 - 0.0003 * uSunSize, sd) * 5.0 + pow(sd, 90.0 / uSunSize) * 0.9 + pow(sd, 5.0) * 0.22 * uSunSize);
        if (uCloud > 0.0) {
          // a slow-moving overcast deck, thicker and darker in its folds
          vec2 cp = d.xz / max(d.y, 0.05) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
          float n = fbm(cp);
          float cover = smoothstep(1.0 - uCloud * 1.2, 1.0 - uCloud * 0.45, n + 0.25);
          vec3 cc = uCloudColor * (0.7 + 0.5 * fbm(cp * 2.6 + 4.0));
          col = mix(col, cc, cover * smoothstep(0.0, 0.1, d.y) * 0.94);
        }
        vec3 c = floor(d * 240.0);
        float s = step(0.9975, hash(c));
        col += s * uStars * vec3(0.9, 0.95, 1.0) * smoothstep(0.08, 0.5, h) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(c + 1.0) * 40.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.scale.setScalar(2000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
