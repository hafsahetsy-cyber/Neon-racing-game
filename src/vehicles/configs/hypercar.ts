import type { VehicleConfig } from '../VehicleConfig';

/** SHAHEEN GT — an original low, wide wedge. The fastest thing in the city; demands respect. */
export const hypercar: VehicleConfig = {
  id: 'shaheen-gt',
  name: 'SHAHEEN GT',
  tagline: 'The falcon does not brake.',
  model: '/models/hypercar.glb',
  mass: 1150,
  chassis: { halfExtents: [0.95, 0.3, 2.25], center: [0, 0.56, 0] },
  comHeight: 0.3,
  wheels: [
    { pos: [-0.86, 0.36, -1.4], radius: 0.36, steer: true, drive: false, handbrake: false, node: 'wheel_fl' },
    { pos: [0.86, 0.36, -1.4], radius: 0.36, steer: true, drive: false, handbrake: false, node: 'wheel_fr' },
    { pos: [-0.88, 0.38, 1.35], radius: 0.38, steer: false, drive: true, handbrake: true, node: 'wheel_rl' },
    { pos: [0.88, 0.38, 1.35], radius: 0.38, steer: false, drive: true, handbrake: true, node: 'wheel_rr' },
  ],
  suspension: { travel: 0.1, frequency: 3.2, damping: 0.7 },
  engine: { topSpeed: 90, accel: 16, reverseSpeed: 14, brake: 30, gears: 7 },
  boost: { accel: 14, topSpeedMul: 1.22, duration: 3.0, regen: 0.075 },
  grip: { lateral: 1.7, longitudinal: 2.4, drift: 0.46, handbrake: 0.32 },
  steer: { maxAngle: 0.52, minAngle: 0.05, speed: 4.6 },
  antiRoll: 0.96,
  driftAngleLimit: 0.6,
  fx: {
    tailLights: [[-0.7, 0.62, 2.28], [0.7, 0.62, 2.28]],
    thrusters: [[-0.3, 0.4, 2.4], [0.3, 0.4, 2.4]],
    headlight: [0, 0.5, -2.2],
  },
  audio: { idleHz: 38, maxHz: 210, character: 'v8' },
  colors: { paint: 0xd4122e, neon: 0xff2bd6, accent: 0x00f0ff },
  stats: { speed: 10, accel: 9, handling: 8, drift: 6 },
  cameraDistance: 1.25,
};
