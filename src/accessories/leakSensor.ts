import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { LeakSensorData } from '../devices/leakSensor.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

/**
 * Leak Sensor Accessory
 * An instance of this class is created for each accessory the platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LeakSensorAccessory {
  private readonly service: Service;
  private readonly battery: Service;
  private _batteryDataCache: Promise<LeakSensorData> | null = null;
  private _cachedBatteryLevel: number;

  private readonly state: {
    hubId: string;
    deviceId: string;
    leak: {
      current: CharacteristicValue;
    };
  };

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly accessory: SmartRentAccessory
  ) {
    const device = this.accessory.context.device;

    // Populate initial state from discovery data
    const initialLeak = findStateByName(device.attributes, 'leak');
    const leakDetected = initialLeak === 'true' || initialLeak === true;

    this.state = {
      hubId: device.room.hub_id.toString(),
      deviceId: device.id.toString(),
      leak: {
        current: leakDetected
          ? this.platform.api.hap.Characteristic.LeakDetected.LEAK_DETECTED
          : this.platform.api.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      },
    };

    this._cachedBatteryLevel = Math.round(Number(device.battery_level ?? 100));

    // set accessory information
    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    // get the LeakDetected service if it exists, otherwise create a new LeakSensor service
    this.service =
      this.accessory.getService(this.platform.api.hap.Service.LeakSensor) ||
      this.accessory.addService(this.platform.api.hap.Service.LeakSensor);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.StatusActive)
      .onGet(() => this.accessory.context.device.online);

    // create handlers for required characteristics
    // see https://developers.homebridge.io/#/service/LeakSensor
    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.LeakDetected)
      .onGet(this.handleLeakDetected.bind(this));

    // set the battery level service for the leak sensor accessory
    this.battery =
      this.accessory.getService(this.platform.api.hap.Service.Battery) ||
      this.accessory.addService(this.platform.api.hap.Service.Battery);
    this.battery.addOptionalCharacteristic(
      this.platform.api.hap.Characteristic.ConfiguredName
    );
    this.battery.setCharacteristic(
      this.platform.api.hap.Characteristic.ConfiguredName,
      `${accessory.context.device.name} Battery`
    );
    this.battery
      .getCharacteristic(this.platform.api.hap.Characteristic.BatteryLevel)
      .onGet(this.handleBatteryLevelGet.bind(this));
    this.battery
      .getCharacteristic(this.platform.api.hap.Characteristic.StatusLowBattery)
      .onGet(this.handleStatusLowBatteryGet.bind(this));

    // subscribe to device events
    this.platform.smartRentApi.websocket.event[this.state.deviceId] = (
      event: WSEvent
    ) => this.handleDeviceStateChanged(event);
  }

  /**
   * Handle requests to get the current value of the "Leak Detected" characteristic
   */
  async handleLeakDetected(): Promise<CharacteristicValue> {
    this.platform.log.debug(
      `Triggered GET LeakDetected for "${this.accessory.context.device.name}" (${this.state.deviceId})`
    );
    return this.state.leak.current;
  }

  private _getBatteryData(): Promise<LeakSensorData> {
    if (!this._batteryDataCache) {
      this._batteryDataCache =
        this.platform.smartRentApi.getData<LeakSensorData>(
          this.state.hubId,
          this.state.deviceId
        );
      this._batteryDataCache
        .then(data => {
          this._cachedBatteryLevel = Math.round(Number(data.battery_level));
        })
        .finally(() => {
          setTimeout(() => {
            this._batteryDataCache = null;
          }, 30000);
        });
    }
    return this._batteryDataCache;
  }

  async handleBatteryLevelGet(): Promise<CharacteristicValue> {
    const deviceName = this.accessory.context.device.name;
    this.platform.log.debug(`Reading battery level for "${deviceName}"`);
    try {
      const data = await this._getBatteryData();
      const batteryLevel = Math.round(Number(data.battery_level));
      this.platform.log.info(`"${deviceName}" battery level: ${batteryLevel}%`);
      return batteryLevel;
    } catch (error) {
      this.platform.log.error(
        `Failed to get battery level for "${deviceName}":`,
        error
      );
      return this._cachedBatteryLevel;
    }
  }

  async handleStatusLowBatteryGet(): Promise<CharacteristicValue> {
    const deviceName = this.accessory.context.device.name;
    try {
      const data = await this._getBatteryData();
      const batteryLevel = Math.round(Number(data.battery_level));
      const threshold = this.platform.config.lowBatteryThreshold ?? 20;
      return batteryLevel <= threshold
        ? this.platform.api.hap.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_LOW
        : this.platform.api.hap.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_NORMAL;
    } catch (error) {
      this.platform.log.error(
        `Failed to get low battery status for "${deviceName}":`,
        error
      );
      const threshold = this.platform.config.lowBatteryThreshold ?? 20;
      return this._cachedBatteryLevel <= threshold
        ? this.platform.api.hap.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_LOW
        : this.platform.api.hap.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_NORMAL;
    }
  }

  /**
   * Handle device state changed events
   * @param event
   */
  handleDeviceStateChanged(event: WSEvent) {
    const deviceName = this.accessory.context.device.name;
    this.platform.log.debug(
      `Device "${deviceName}" (${this.state.deviceId}) state changed: ${JSON.stringify(event)}`
    );

    if (event.name !== 'leak') {
      return;
    }

    // Handle string values from websocket events
    const leakDetected = event.last_read_state === 'true';
    const leak = leakDetected
      ? this.platform.api.hap.Characteristic.LeakDetected.LEAK_DETECTED
      : this.platform.api.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED;

    this.platform.log.debug(
      `Leak sensor "${deviceName}" websocket update: state="${event.last_read_state}", leak=${leakDetected}`
    );

    this.state.leak.current = leak;
    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.LeakDetected,
      leak
    );
  }
}
