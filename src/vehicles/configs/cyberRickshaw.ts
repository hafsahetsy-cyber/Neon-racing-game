import type { VehicleConfig } from '../VehicleConfig';

/**
 * Cyber Rickshaw — starter vehicle. Short wheelbase, light, eager to rotate.
 * Physics uses two close-set front wheels for stability; the model shows one.
 */
export const cyberRickshaw: VehicleConfig = {
  id: 'cyber-rickshaw',
  name: 'CYBER RICKSHAW',
  tagline: 'Three wheels. Zero chill.',
  model: '/models/cyber_rickshaw.glb',
  mass: 520,
  chassis: { halfExtents: [0.62, 0.42, 1.3], center: [0, 0.78, -0.05] },
  comHeight: 0.38,
  wheels: [
    { pos: [-0.45, 0.3, -1.05], radius: 0.3, steer: true, drive: false, handbrake: false, node: 'wheel_f', visualX: 0 },
    { pos: [0.45, 0.3, -1.05], radius: 0.3, steer: true, drive: false, handbrake: false },
    { pos: [-0.68, 0.34, 0.85], radius: 0.34, steer: false, drive: true, handbrake: true, node: 'wheel_rl' },
    { pos: [0.68, 0.34, 0.85], radius: 0.34, steer: false, drive: true, handbrake: true, node: 'wheel_rr' },
  ],
  suspension: { travel: 0.16, frequency: 2.6, damping: 0.62 },
  engine: { topSpeed: 47, accel: 11.5, reverseSpeed: 12, brake: 22, gears: 5 },
  boost: { accel: 13, topSpeedMul: 1.38, duration: 3.2, regen: 0.085 },
  grip: { lateral: 1.4, longitudinal: 2.1, drift: 0.55, handbrake: 0.42 },
  steer: { maxAngle: 0.6, minAngle: 0.085, speed: 4.2 },
  antiRoll: 0.94,
  driftAngleLimit: 0.72,
  fx: {
    tailLights: [
      [-0.5, 0.9, 1.34],
      [0.5, 0.9, 1.34],
    ],
    thrusters: [
      [-0.3, 0.45, 1.5],
      [0.3, 0.45, 1.5],
    ],
    headlight: [0, 0.8, -1.0],
  },
  audio: { idleHz: 26, maxHz: 150, character: 'twostroke' },
  colors: { paint: 0x12b8a6, neon: 0x00f0ff, accent: 0xff2bd6 },
  stats: { speed: 5, accel: 7, handling: 8, drift: 9 },
};
