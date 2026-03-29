import { PlatformConfig } from 'homebridge';

export interface SmartRentPlatformConfig extends PlatformConfig {
  platform: 'SmartRent';
  unitName?: string;
  email: string;
  password: string;
  tfaSecret?: string;
  enableLeakSensors?: boolean;
  enableMotionSensors?: boolean;
  enableLocks?: boolean;
  enableSwitches?: boolean;
  enableThermostats?: boolean;
  enableSwitchMultiLevels?: boolean;
  enableAutoLock?: boolean;
  autoLockDelayInMinutes?: number;
  excludeDevices?: number[];
  lowBatteryThreshold?: number;

  temperatureUnit?: 'fahrenheit' | 'celsius';
  verboseLogging?: boolean;
}
