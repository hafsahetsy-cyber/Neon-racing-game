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
  /** Optional city-wide ambience (Lahore's kites, …). */
  ambient?: (ctx: { group: THREE.Group; animate: (fn: (time: number) => void) => void; half: [number, number] }) => void;
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
