import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { LockData } from '../devices/lock.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

/**
 * Lock Accessory
 * An instance of this class is created for each accessory the platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockAccessory {
  private readonly service: Service;
  private readonly battery: Service;
  private timer?: NodeJS.Timeout;
  private timerSet: boolean = false;
  private _batteryDataCache: Promise<LockData> | null = null;

  private readonly state: {
    hubId: string;
    deviceId: string;
    locked: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
  };

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly accessory: SmartRentAccessory
  ) {
    this.state = {
      hubId: this.accessory.context.device.room.hub_id.toString(),
      deviceId: this.accessory.context.device.id.toString(),
      locked: {
        current: this.platform.api.hap.Characteristic.LockTargetState.UNSECURED,
        target: this.platform.api.hap.Characteristic.LockTargetState.UNSECURED,
      },
    };

    // set accessory information
    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    // set the battery level service for the lock accessory
    this.battery =
      this.accessory.getService(this.platform.api.hap.Service.Battery) ||
      this.accessory.addService(this.platform.api.hap.Service.Battery);
    this.battery
      .getCharacteristic(this.platform.api.hap.Characteristic.BatteryLevel)
      .onGet(this.handleBatteryLevelGet.bind(this));
    this.battery
      .getCharacteristic(this.platform.api.hap.Characteristic.StatusLowBattery)
      .onGet(this.handleStatusLowBatteryGet.bind(this));

    // get the LockMechanism service if it exists, otherwise create a new LockMechanism service
    this.service =
      this.accessory.getService(this.platform.api.hap.Service.LockMechanism) ||
      this.accessory.addService(this.platform.api.hap.Service.LockMechanism);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.StatusActive)
      .onGet(() => this.accessory.context.device.online);

    // create handlers for required characteristics
    // see https://developers.homebridge.io/#/service/LockMechanism
    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.LockCurrentState)
      .onGet(this.handleLockCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.LockTargetState)
      .onGet(this.handleLockTargetStateGet.bind(this))
      .onSet(this.handleLockTargetStateSet.bind(this));

    // subscribe to the lock state change event
    this.platform.smartRentApi.websocket.event[this.state.deviceId] =
      this.handleLockEvent.bind(this);
  }

  private _getBatteryData(): Promise<LockData> {
    if (!this._batteryDataCache) {
      this._batteryDataCache = this.platform.smartRentApi.getData<LockData>(
        this.state.hubId,
        this.state.deviceId
      );
      this._batteryDataCache.finally(() => {
        setTimeout(() => {
          this._batteryDataCache = null;
        }, 500);
      });
    }
    return this._batteryDataCache;
  }

  /**
   * Handle requests to get the current value of the "Battery Level" characteristic
   */
  async handleBatteryLevelGet(): Promise<CharacteristicValue> {
    const deviceName = this.accessory.context.device.name;
    this.platform.log.debug(`Reading battery level for "${deviceName}"`);

    try {
      const lockData = await this._getBatteryData();
      const batteryLevel = Math.round(Number(lockData.battery_level));
      this.platform.log.info(`"${deviceName}" battery level: ${batteryLevel}%`);
      return batteryLevel;
    } catch (error) {
      this.platform.log.error(
        `Failed to get battery level for "${deviceName}":`,
        error
      );
      throw error;
    }
  }

  async handleStatusLowBatteryGet(): Promise<CharacteristicValue> {
    const deviceName = this.accessory.context.device.name;
    try {
      const lockData = await this._getBatteryData();
      const batteryLevel = Math.round(Number(lockData.battery_level));
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
      return this.platform.api.hap.Characteristic.StatusLowBattery
        .BATTERY_LEVEL_NORMAL;
    }
  }

  private readonly LOCKED: string = 'locked';

  /**
   * Handle requests to get the current value of the "Lock Current State" characteristic
   */
  async handleLockCurrentStateGet(): Promise<CharacteristicValue> {
    const deviceName = this.accessory.context.device.name;
    this.platform.log.debug(`Reading lock state for "${deviceName}"`);

    try {
      const lockAttributes =
        await this.platform.smartRentApi.getState<LockData>(
          this.state.hubId,
          this.state.deviceId
        );

      const locked = findStateByName(lockAttributes, this.LOCKED) as string;
      const isLocked = locked === 'true';

      const currentValue = isLocked
        ? this.platform.api.hap.Characteristic.LockTargetState.SECURED
        : this.platform.api.hap.Characteristic.LockTargetState.UNSECURED;

      this.state.locked.current = currentValue;

      this.platform.log.info(
        `"${deviceName}" current lock state: ${isLocked ? 'LOCKED' : 'UNLOCKED'} (API: "${locked}")`
      );

      return currentValue;
    } catch (error) {
      this.platform.log.error(
        `Failed to get lock state for "${deviceName}":`,
        error
      );
      throw error;
    }
  }

  /**
   * Handle requests to get the current value of the "Lock Target State" characteristic
   */
  async handleLockTargetStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(
      'Triggered GET LockTargetState',
      this.state.locked.target
    );
    const lockAttributes = await this.platform.smartRentApi.getState<LockData>(
      this.state.hubId,
      this.state.deviceId
    );
    const locked = findStateByName(lockAttributes, this.LOCKED) as boolean;
    return locked
      ? this.platform.api.hap.Characteristic.LockTargetState.SECURED
      : this.platform.api.hap.Characteristic.LockTargetState.UNSECURED;
  }

  /**
   * Handle requests to set the "Lock Target State" characteristic
   */
  async handleLockTargetStateSet(value: CharacteristicValue) {
    const deviceName = this.accessory.context.device.name;
    const targetState =
      value === this.platform.api.hap.Characteristic.LockTargetState.SECURED
        ? 'LOCK'
        : 'UNLOCK';

    this.platform.log.info(`Setting "${deviceName}" to ${targetState}`);

    try {
      this.state.locked.target = value;
      const attributes = [{ name: this.LOCKED, state: !!value }];

      await this.platform.smartRentApi.setState<LockData>(
        this.state.hubId,
        this.state.deviceId,
        attributes
      );

      this.scheduleAutoLock(value);
      this.platform.log.info(
        `Successfully set "${deviceName}" to ${targetState}`
      );
    } catch (error) {
      this.platform.log.error(
        `Failed to set "${deviceName}" to ${targetState}:`,
        error
      );
      throw error;
    }
  }

  private scheduleAutoLock(value: CharacteristicValue) {
    if (
      value ===
        this.platform.api.hap.Characteristic.LockTargetState.UNSECURED &&
      this.platform.config.enableAutoLock &&
      this.platform.config.autoLockDelayInMinutes
    ) {
      if (this.timerSet) {
        return;
      }
      this.platform.log.debug(
        'Lock is unlocked, starting timer to relock in ',
        this.platform.config.autoLockDelayInMinutes,
        ' minutes'
      );
      this.timerSet = true;
      this.timer = setTimeout(
        async () => {
          try {
            this.platform.log.debug('Relocking lock');
            await this.handleLockTargetStateSet(true);
          } catch (error) {
            this.platform.log.error('Auto-lock failed:', error);
          } finally {
            this.timerSet = false;
          }
        },
        this.platform.config.autoLockDelayInMinutes * 60 * 1000
      );
    } else if (this.timer) {
      this.platform.log.debug('Lock is locked, clearing timer');
      clearTimeout(this.timer);
      this.timerSet = false;
    }
  }

  /**
   * Handle lock websocket events
   */
  async handleLockEvent(event: WSEvent) {
    this.platform.log.debug('Received event on Lock: ', event);

    if (event.name === 'notifications') {
      this.handleNotificationEvent(event);
      return;
    }

    if (event.name !== this.LOCKED) {
      return;
    }

    const currentValue =
      event.last_read_state === 'true'
        ? this.platform.api.hap.Characteristic.LockTargetState.SECURED
        : this.platform.api.hap.Characteristic.LockTargetState.UNSECURED;
    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.LockCurrentState,
      currentValue
    );
    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.LockTargetState,
      currentValue
    );
    this.scheduleAutoLock(currentValue);
  }

  private handleNotificationEvent(event: WSEvent) {
    const deviceName = this.accessory.context.device.name;
    const message = event.last_read_state?.toLowerCase() ?? '';

    this.platform.log.debug(
      `Lock "${deviceName}" notification: "${event.last_read_state}"`
    );

    if (message.includes('jammed')) {
      this.platform.log.warn(`Lock "${deviceName}" is jammed!`);
      this.service.updateCharacteristic(
        this.platform.api.hap.Characteristic.LockCurrentState,
        this.platform.api.hap.Characteristic.LockCurrentState.JAMMED
      );
    }
  }

  /**
   * Refresh the current state of the lock using the SmartRent API HTTP request in intervals
   */
  async updateStateTask() {
    const INTERVAL = (this.platform.config.lockPollingInterval ?? 10) * 1000;
    this.platform.log.debug(
      'Beginning updateStateTask',
      this.state.locked.current
    );
    try {
      const lockAttributes =
        await this.platform.smartRentApi.getState<LockData>(
          this.state.hubId,
          this.state.deviceId
        );
      this.platform.log.debug('lockAttributes', lockAttributes);
      const locked = findStateByName(lockAttributes, this.LOCKED);
      const currentValue =
        locked === 'true'
          ? this.platform.api.hap.Characteristic.LockTargetState.SECURED
          : this.platform.api.hap.Characteristic.LockTargetState.UNSECURED;
      this.state.locked.current = currentValue;
      this.state.locked.target = currentValue;
      this.service
        .getCharacteristic(
          this.platform.api.hap.Characteristic.LockCurrentState
        )
        .updateValue(this.state.locked.current);
      this.service
        .getCharacteristic(this.platform.api.hap.Characteristic.LockTargetState)
        .updateValue(this.state.locked.target);
      this.scheduleAutoLock(currentValue);
    } catch (err) {
      this.platform.log.error('Error getting lock state', err);
      this.service
        .getCharacteristic(
          this.platform.api.hap.Characteristic.LockCurrentState
        )
        .updateValue(
          this.platform.api.hap.Characteristic.LockCurrentState.UNKNOWN
        );
    }

    this.platform.log.debug(
      'Ending updateStateTask',
      this.state.locked.current
    );
    setTimeout(() => {
      this.updateStateTask();
    }, INTERVAL);
  }
}
