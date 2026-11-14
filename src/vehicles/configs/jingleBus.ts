import type { VehicleConfig } from '../VehicleConfig';

/**
 * ROUTE ELEVEN — the decorated city minibus: a crown board over the windscreen, truck-art
 * skirts, luggage on the roof, air horns. Slow to get going, unstoppable once it has.
 */
export const jingleBus: VehicleConfig = {
  id: 'route-eleven',
  name: 'ROUTE ELEVEN',
  tagline: 'Standing room only. Hold on.',
  model: '/models/jingle_bus.glb',
  mass: 2700,
  chassis: { halfExtents: [1.1, 1.1, 3.05], center: [0, 1.62, 0] },
  comHeight: 0.72,
  wheels: [
    { pos: [-0.98, 0.42, -1.9], radius: 0.42, steer: true, drive: false, handbrake: false, node: 'wheel_fl' },
    { pos: [0.98, 0.42, -1.9], radius: 0.42, steer: true, drive: false, handbrake: false, node: 'wheel_fr' },
    { pos: [-0.98, 0.42, 1.7], radius: 0.42, steer: false, drive: true, handbrake: true, node: 'wheel_rl' },
    { pos: [0.98, 0.42, 1.7], radius: 0.42, steer: false, drive: true, handbrake: true, node: 'wheel_rr' },
  ],
  suspension: { travel: 0.17, frequency: 2.0, damping: 0.7 },
  engine: { topSpeed: 40, accel: 6.8, reverseSpeed: 8, brake: 15, gears: 5 },
  boost: { accel: 11, topSpeedMul: 1.45, duration: 4.2, regen: 0.07 },
  grip: { lateral: 1.35, longitudinal: 2.2, drift: 0.52, handbrake: 0.36 },
  steer: { maxAngle: 0.55, minAngle: 0.1, speed: 3.0 },
  antiRoll: 0.97,
  driftAngleLimit: 0.5,
  fx: {
    tailLights: [[-0.85, 1.15, 3.04], [0.85, 1.15, 3.04]],
    thrusters: [[-0.5, 0.6, 3.32], [0.5, 0.6, 3.32]],
    headlight: [0, 1.1, -3.05],
  },
  audio: { idleHz: 22, maxHz: 115, character: 'v8' },
  colors: { paint: 0x1560ff, neon: 0xffd23f, accent: 0xff2bd6 },
  stats: { speed: 3, accel: 3, handling: 4, drift: 6 },
  cameraDistance: 1.6,
};
