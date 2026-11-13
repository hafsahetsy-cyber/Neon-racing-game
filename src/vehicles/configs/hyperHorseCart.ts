import type { VehicleConfig } from '../VehicleConfig';

/**
 * TANGA-X — a supercar-grade horse cart pulled by a holographic energy steed.
 * Long and stable: huge top speed, lazy to rotate.
 */
export const hyperHorseCart: VehicleConfig = {
  id: 'tanga-x',
  name: 'TANGA-X',
  tagline: 'One horsepower. Roughly nine thousand.',
  model: '/models/hyper_horse_cart.glb',
  mass: 760,
  chassis: { halfExtents: [0.75, 0.42, 2.3], center: [0, 0.86, -0.75] },
  comHeight: 0.42,
  comZ: -0.6,
  wheels: [
    // the steed hovers, so the front pair is physics-only
    { pos: [-0.5, 0.3, -1.9], radius: 0.3, steer: true, drive: false, handbrake: false },
    { pos: [0.5, 0.3, -1.9], radius: 0.3, steer: true, drive: false, handbrake: false },
    { pos: [-0.95, 0.55, 0.5], radius: 0.55, steer: false, drive: true, handbrake: true, node: 'wheel_rl' },
    { pos: [0.95, 0.55, 0.5], radius: 0.55, steer: false, drive: true, handbrake: true, node: 'wheel_rr' },
  ],
  suspension: { travel: 0.15, frequency: 2.4, damping: 0.65 },
  engine: { topSpeed: 76, accel: 10.5, reverseSpeed: 9, brake: 20, gears: 6 },
  boost: { accel: 16, topSpeedMul: 1.3, duration: 3.6, regen: 0.08 },
  grip: { lateral: 1.5, longitudinal: 2.7, drift: 0.48, handbrake: 0.34 },
  steer: { maxAngle: 0.5, minAngle: 0.06, speed: 3.6 },
  antiRoll: 0.95,
  driftAngleLimit: 0.55,
  fx: {
    tailLights: [[-0.55, 0.75, 1.48], [0.55, 0.75, 1.48]],
    thrusters: [[-0.35, 0.5, 1.5], [0.35, 0.5, 1.5]],
    headlight: [0, 1.4, -3.2],
  },
  audio: { idleHz: 60, maxHz: 420, character: 'electric' },
  colors: { paint: 0x2a1a6e, neon: 0x7dff5a, accent: 0xffa630 },
  stats: { speed: 9, accel: 6, handling: 6, drift: 4 },
  cameraDistance: 1.35,
};
