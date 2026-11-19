import type { CityDefinition } from '../city/types';
import { karachi } from './karachi';
import { dubai } from './dubai';
import { lahore } from './lahore';
import { london } from './london';

/** Every playable city, in menu order. Adding one = a CityDefinition + a map.json + a line here. */
export const CITIES: CityDefinition[] = [karachi, lahore, dubai, london];

export const cityById = (id: string | null | undefined) => CITIES.find((c) => c.id === id) ?? CITIES[0];
export const cityByCodePrefix = (prefix: string) => CITIES.find((c) => c.codePrefix === prefix);
