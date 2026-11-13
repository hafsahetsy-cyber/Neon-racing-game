import { VEHICLES } from '../vehicles/registry';

const KEY = 'neoncruise.save';

export interface SaveData {
  vehicle: string;
  colors: Record<string, { paint: number; neon: number; accent: number }>;
  music: number;
  sfx: number;
}

export function loadSave(): SaveData {
  let s: Partial<SaveData> = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    /* corrupt save: start fresh */
  }
  const data: SaveData = { vehicle: s.vehicle ?? VEHICLES[0].id, colors: s.colors ?? {}, music: s.music ?? 0.5, sfx: s.sfx ?? 0.7 };
  // saved paint jobs override the factory colours
  for (const v of VEHICLES) if (data.colors[v.id]) Object.assign(v.colors, data.colors[v.id]);
  return data;
}

export function storeSave(s: SaveData) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
