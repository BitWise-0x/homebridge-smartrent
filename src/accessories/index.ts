import { PlatformAccessory, UnknownContext } from 'homebridge';
import { DeviceDataUnion } from '../devices/index.js';

export * from './leakSensor.js';
export * from './lock.js';
export * from './motionSensor.js';
export * from './switch.js';
export * from './thermostat.js';
export * from './switchMultilevel.js';

export interface AccessoryContext extends UnknownContext {
  device: DeviceDataUnion;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SmartRentAccessory = PlatformAccessory<Record<string, any>>;
