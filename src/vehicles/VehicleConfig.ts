/**
 * A vehicle is fully described by one of these configs plus a .glb model.
 * Local space: +X right, +Y up, -Z forward. Origin sits on the ground under the car's centre.
 */
export interface WheelConfig {
  /** Wheel centre at rest, local space. */
  pos: [number, number, number];
  radius: number;
  steer: boolean;
  drive: boolean;
  /** Locked by the handbrake. */
  handbrake: boolean;
  /** Name of the wheel node in the .glb. Omit for physics-only helper wheels. */
  node?: string;
  /** Override the visual X position (e.g. two physics wheels sharing one centre visual wheel). */
  visualX?: number;
}

export interface VehicleConfig {
  id: string;
  name: string;
  tagline: string;
  model: string;
  mass: number;
  chassis: { halfExtents: [number, number, number]; center: [number, number, number] };
  /** Centre of mass height above the ground origin. Lower = more stable. */
  comHeight: number;
  /** Fore/aft centre of mass (negative = forward). Keep it between the axles. */
  comZ?: number;
  wheels: WheelConfig[];
  suspension: { travel: number; frequency: number; damping: number };
  engine: {
    /** m/s */
    topSpeed: number;
    /** Peak acceleration in m/s^2. */
    accel: number;
    reverseSpeed: number;
    brake: number;
    gears: number;
  };
  boost: { accel: number; topSpeedMul: number; duration: number; regen: number };
  grip: {
    lateral: number;
    longitudinal: number;
    /** Rear grip multiplier once the tail is sliding. Lower = longer, lazier drifts. */
    drift: number;
    /** Rear grip multiplier while the handbrake is held. */
    handbrake: number;
  };
  steer: { maxAngle: number; minAngle: number; speed: number };
  /** 0..1 — how much body roll/pitch from tyre forces is cancelled. */
  antiRoll: number;
  /** Radians. Beyond this slide angle the drift assist reins the tail in. */
  driftAngleLimit: number;
  /** Local positions used by effects. */
  fx: {
    tailLights: [number, number, number][];
    thrusters: [number, number, number][];
    headlight: [number, number, number];
  };
  audio: { idleHz: number; maxHz: number; character: 'twostroke' | 'v8' | 'electric' | 'turbine' };
  colors: { paint: number; neon: number; accent: number };
  /** 0..10 values shown in the garage. */
  stats: { speed: number; accel: number; handling: number; drift: number };
  /** Chase-camera distance multiplier for long vehicles. */
  cameraDistance?: number;
}

/**
 * The speed (m/s) a vehicle actually settles at on the flat without boost: where the engine's
 * tapering push equals aerodynamic drag. Mirrors the constants in Vehicle.step().
 */
export function realTopSpeed(c: VehicleConfig): number {
  let lo = 0;
  let hi = c.engine.topSpeed;
  for (let i = 0; i < 30; i++) {
    const v = (lo + hi) / 2;
    const push = c.engine.accel * (1 - Math.pow(v / c.engine.topSpeed, 2.6));
    if (push > 0.00055 * v * v) lo = v;
    else hi = v;
  }
  return lo;
}
