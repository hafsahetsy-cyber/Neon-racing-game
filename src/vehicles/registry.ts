import type { VehicleConfig } from './VehicleConfig';
import { cyberRickshaw } from './configs/cyberRickshaw';
import { hyperHorseCart } from './configs/hyperHorseCart';
import { duneHauler } from './configs/duneHauler';
import { hypercar } from './configs/hypercar';
import { jingleBus } from './configs/jingleBus';
import { nomad4x4 } from './configs/nomad4x4';

/** Every drivable vehicle, in garage order. Adding one = a config file + a .glb + a line here. */
export const VEHICLES: VehicleConfig[] = [cyberRickshaw, hyperHorseCart, hypercar, jingleBus, duneHauler, nomad4x4];

export const vehicleById = (id: string) => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
