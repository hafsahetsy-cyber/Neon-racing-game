import type { VehicleConfig } from './VehicleConfig';
import { cyberRickshaw } from './configs/cyberRickshaw';
import { hyperHorseCart } from './configs/hyperHorseCart';
import { hypercar } from './configs/hypercar';

/** Every drivable vehicle, in garage order. Adding one = a config file + a .glb + a line here. */
export const VEHICLES: VehicleConfig[] = [cyberRickshaw, hyperHorseCart, hypercar];

export const vehicleById = (id: string) => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
