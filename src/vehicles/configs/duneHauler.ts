import type { VehicleConfig } from '../VehicleConfig';

/**
 * DUNE HAULER — an old white single-cab pickup, the workhorse of every desert road:
 * roll bar of spotlights, barrels and a spare in the bed, tyres made for sand.
 */
export const duneHauler: VehicleConfig = {
  id: 'dune-hauler',
  name: 'DUNE HAULER',
  tagline: 'Forty years old. Still outruns you.',
  model: '/models/dune_hauler.glb',
  mass: 1350,
  chassis: { halfExtents: [0.88, 0.5, 2.42], center: [0, 1.16, 0] },
  comHeight: 0.52,
  wheels: [
    { pos: [-0.86, 0.4, -1.5], radius: 0.4, steer: true, drive: true, handbrake: false, node: 'wheel_fl' },
    { pos: [0.86, 0.4, -1.5], radius: 0.4, steer: true, drive: true, handbrake: false, node: 'wheel_fr' },
    { pos: [-0.86, 0.4, 1.45], radius: 0.4, steer: false, drive: true, handbrake: true, node: 'wheel_rl' },
    { pos: [0.86, 0.4, 1.45], radius: 0.4, steer: false, drive: true, handbrake: true, node: 'wheel_rr' },
  ],
  suspension: { travel: 0.22, frequency: 2.0, damping: 0.6 },
  engine: { topSpeed: 62, accel: 11.5, reverseSpeed: 12, brake: 22, gears: 5 },
  boost: { accel: 12, topSpeedMul: 1.28, duration: 3.2, regen: 0.08 },
  grip: { lateral: 1.45, longitudinal: 2.3, drift: 0.5, handbrake: 0.36 },
  steer: { maxAngle: 0.56, minAngle: 0.07, speed: 4.0 },
  antiRoll: 0.95,
  driftAngleLimit: 0.66,
  // light and on fat tyres: keeps most of its grip on sand and shallow water
  offroad: 0.7,
  fx: {
    tailLights: [[-0.72, 1.0, 2.49], [0.72, 1.0, 2.49]],
    thrusters: [[-0.4, 0.62, 2.62], [0.4, 0.62, 2.62]],
    headlight: [0, 1.0, -2.33],
  },
  audio: { idleHz: 30, maxHz: 175, character: 'v8' },
  colors: { paint: 0xf5f5f0, neon: 0xffa630, accent: 0xff6a13 },
  stats: { speed: 6, accel: 7, handling: 6, drift: 8 },
  cameraDistance: 1.25,
};
