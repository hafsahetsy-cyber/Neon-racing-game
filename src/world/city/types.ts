import type * as THREE from 'three';

/** Compact map produced by tools/build-city.mjs from OpenStreetMap data. */
export interface MapRoad {
  /** 0 trunk · 1 primary · 2 secondary · 3 tertiary · 4 residential · 5 service */
  c: number;
  w: number;
  o: 0 | 1;
  l: number;
  n: string;
  /** Flat [x, z, x, z, …] polyline in metres. */
  p: number[];
  /** Marked at runtime: a back lane that cuts between main roads (drawn amber on the mini-map). */
  shortcut?: boolean;
}
export interface MapBuilding {
  /** 0 old city · 1 neon megatower · 2 heritage · 3 modern plaza */
  s: number;
  h: number;
  p: number[];
  n?: string;
}
export interface CityMap {
  attribution: string;
  half: [number, number];
  landmarks: { id: string; name: string; x: number; z: number }[];
  roads: MapRoad[];
  buildings: MapBuilding[];
  parks: number[][];
  routes?: import('../../race/Race').Route[];
}

/** Everything that makes one city different from another. Adding a city = one of these + a map.json. */
export interface CityDefinition {
  id: string;
  name: string;
  tagline: string;
  /** One line for the city-select card. */
  blurb: string;
  /** Three letters that start this city's party codes, e.g. KHI. */
  codePrefix: string;
  music: import('../../audio/Music').MusicStyle;
  /** The city's own neon colours, strongest first. Used for towers, signs, trims, traffic and set pieces. */
  neon: number[];
  /** Time of day, sky and air — the first thing that tells two cities apart. */
  atmosphere: Atmosphere;
  /** Which family of facades and rooftops the building generator draws. */
  architecture: 'colonial' | 'mughal';
  /** Relative share of each ambient traffic type. */
  trafficMix: Partial<Record<TrafficKind, number>>;
  /** Streams of flying traffic overhead (0 for none). */
  skyLanes: number;
  /** Compass arc [from, to] in radians (atan2(z, x)) kept free of skyline towers — open water, usually. */
  skylineGap?: [number, number];
  /** Terrain, water, things in the sky and the signature drive: composed from world/city/features.ts. */
  features?: (ctx: FeatureContext) => void;
  map: string;
  fog: { color: number; density: number };
  sky: { horizon: number; zenith: number };
  /** Street-light colour (Karachi: sodium orange). */
  streetLight: number;
  /** Facade base colours for old-city buildings. */
  facades: number[];
  heritageStone: number;
  /** Words for neon shop signs (any script the browser can render). */
  signWords: string[];
  /** Which side of the road traffic keeps to. */
  driveSide: 'left' | 'right';
  /** Preferred spawn location; snapped to the nearest main road. */
  spawnNear: [number, number];
  /** Hand-built landmarks keyed by the ids in map.json. */
  landmarks: Record<string, LandmarkBuilder>;
}

export type TrafficKind = 'bus' | 'rickshaw' | 'car' | 'bike' | 'tonga';

export interface Atmosphere {
  /** 0 = deep night … 1 = full daylight on the facades. */
  daylight: number;
  /** Sun or moon: direction it shines from, colour, apparent size and light strength. */
  sun: { dir: [number, number, number]; color: number; size: number; intensity: number };
  /** Sky colour between horizon and zenith. */
  skyMid: number;
  /** 0..1 star visibility. */
  stars: number;
  hemi: { sky: number; ground: number; intensity: number };
  /** Strength of the street-light colour as ambient light. */
  ambient: number;
  /** Glowing halos round street lamps (0 = clear air … 1 = thick smog). */
  halo: number;
  /** How much the fog slowly thickens and thins (sea fog rolling in). */
  fogBreath: number;
}

export interface FeatureContext {
  group: THREE.Group;
  animate(fn: (time: number) => void): void;
  half: [number, number];
  roads: MapRoad[];
  neon: number[];
  fogColor: THREE.Color;
  fogDensity: number;
  /** World-space box collider. */
  addBox(center: THREE.Vector3, size: THREE.Vector3, quat?: THREE.Quaternion): void;
}

export interface LandmarkContext {
  x: number;
  z: number;
  /** Heading of the nearest road, so landmarks sit square to the street grid. */
  yaw: number;
  group: THREE.Group;
  /** Local-space [x, z] footprint, extruded through the normal building pipeline (visuals + collision). */
  addFootprint(points: [number, number][], height: number, style: number): void;
  /** Local-space box collider. */
  addBoxCollider(pos: THREE.Vector3, size: THREE.Vector3): void;
  /** Convex hull from local-space points (ramps, plinths). */
  addHullCollider(points: Float32Array): void;
  /** Register something to animate every frame. */
  animate(fn: (time: number) => void): void;
}
export type LandmarkBuilder = (ctx: LandmarkContext) => void;
