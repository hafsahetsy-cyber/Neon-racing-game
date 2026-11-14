import { VEHICLES } from '../vehicles/registry';

const KEY = 'neoncruise.save';

export interface SaveData {
  vehicle: string;
  colors: Record<string, { paint: number; neon: number; accent: number }>;
  music: number;
  sfx: number;
  name: string;
  city: string;
  /** Best race times in seconds, keyed by "route|vehicle". */
  best: Record<string, number>;
}

export function loadSave(): SaveData {
  let s: Partial<SaveData> = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    /* corrupt save: start fresh */
  }
  const data: SaveData = { vehicle: s.vehicle ?? VEHICLES[0].id, colors: s.colors ?? {}, music: s.music ?? 0.5, sfx: s.sfx ?? 0.7,
    name: s.name ?? `Driver-${Math.floor(100 + Math.random() * 900)}`, best: s.best ?? {}, city: s.city ?? 'karachi' };
  // saved paint jobs override the factory colours
  for (const v of VEHICLES) if (data.colors[v.id]) Object.assign(v.colors, data.colors[v.id]);
  return data;
}

export function storeSave(s: SaveData) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
