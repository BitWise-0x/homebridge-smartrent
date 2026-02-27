import { LeakSensorData } from './leakSensor.js';
import { LockData } from './lock.js';
import { MotionSensorData } from './motionSensor.js';
import { SwitchData } from './switch.js';
import { SwitchMultilevelData } from './switchMultilevel.js';
import { ThermostatData } from './thermostat.js';

export * from './base.js';
export * from './leakSensor.js';
export * from './lock.js';
export * from './motionSensor.js';
export * from './switch.js';
export * from './thermostat.js';
export * from './switchMultilevel.js';

export type DeviceDataUnion =
  | LeakSensorData
  | LockData
  | MotionSensorData
  | SwitchData
  | ThermostatData
  | SwitchMultilevelData;
