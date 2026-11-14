import type { VehicleConfig } from '../VehicleConfig';

/**
 * NOMAD 4X4 — a big, square desert wagon: snorkel, winch, roof rack with a light bar,
 * spare on the back door. Heavy, fast in a straight line, and almost indifferent to sand.
 */
export const nomad4x4: VehicleConfig = {
  id: 'nomad-4x4',
  name: 'NOMAD 4X4',
  tagline: 'The dunes are just another road.',
  model: '/models/nomad_4x4.glb',
  mass: 2150,
  chassis: { halfExtents: [0.97, 0.66, 2.45], center: [0, 1.3, 0] },
  comHeight: 0.56,
  wheels: [
    { pos: [-0.9, 0.43, -1.55], radius: 0.43, steer: true, drive: true, handbrake: false, node: 'wheel_fl' },
    { pos: [0.9, 0.43, -1.55], radius: 0.43, steer: true, drive: true, handbrake: false, node: 'wheel_fr' },
    { pos: [-0.9, 0.43, 1.5], radius: 0.43, steer: false, drive: true, handbrake: true, node: 'wheel_rl' },
    { pos: [0.9, 0.43, 1.5], radius: 0.43, steer: false, drive: true, handbrake: true, node: 'wheel_rr' },
  ],
  suspension: { travel: 0.22, frequency: 1.9, damping: 0.65 },
  engine: { topSpeed: 70, accel: 12.5, reverseSpeed: 12, brake: 24, gears: 6 },
  boost: { accel: 13, topSpeedMul: 1.25, duration: 3.4, regen: 0.075 },
  grip: { lateral: 1.5, longitudinal: 2.5, drift: 0.55, handbrake: 0.4 },
  steer: { maxAngle: 0.52, minAngle: 0.06, speed: 3.6 },
  antiRoll: 0.96,
  driftAngleLimit: 0.55,
  offroad: 0.88,
  fx: {
    tailLights: [[-0.86, 1.2, 2.46], [0.86, 1.2, 2.46]],
    thrusters: [[-0.45, 0.62, 2.62], [0.45, 0.62, 2.62]],
    headlight: [0, 1.12, -2.46],
  },
  audio: { idleHz: 26, maxHz: 150, character: 'v8' },
  colors: { paint: 0xd9c7a3, neon: 0x00f0ff, accent: 0xffa630 },
  stats: { speed: 7, accel: 7, handling: 6, drift: 5 },
  cameraDistance: 1.3,
};
