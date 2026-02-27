import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { SwitchMultilevelData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

/**
 * Switch Muiltilevel Accessory
 * An instance of this class is created for each accessory the platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SwitchMultilevelAccessory {
  private readonly service: Service;

  private readonly state: {
    hubId: string;
    deviceId: string;
    on: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
    brightness: {
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
      on: {
        current: 0,
        target: 0,
      },
      brightness: {
        current: 0,
        target: 0,
      },
    };

    // set accessory information
    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    // get the Switch Multilevel service if it exists, otherwise create a new Switch Multilevel service
    this.service =
      this.accessory.getService(this.platform.api.hap.Service.Lightbulb) ||
      this.accessory.addService(this.platform.api.hap.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.StatusActive)
      .onGet(() => this.accessory.context.device.online);

    // create handlers for required characteristics
    // see https://developers.homebridge.io/#/service/Lightbulb
    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.Brightness)
      .onGet(this.handleBrightnessGet.bind(this))
      .onSet(this.handleBrightnessSet.bind(this));

    // subscribe to device state changed events
    this.platform.smartRentApi.websocket.event[this.state.deviceId] = (
      event: WSEvent
    ) => this.handleDeviceStateChanged(event);
  }

  /**
   * Handle device state changed events
   */
  async handleDeviceStateChanged(event: WSEvent) {
    this.platform.log.debug(
      'Received websocket Switch Multilevel event:',
      event
    );

    if (event.name === 'level') {
      const level = Number(event.last_read_state);
      this.state.brightness.current = level;
      this.state.on.current = level > 0 ? 1 : 0;
      this.service.updateCharacteristic(
        this.platform.api.hap.Characteristic.Brightness,
        level
      );
      this.service.updateCharacteristic(
        this.platform.api.hap.Characteristic.On,
        this.state.on.current
      );
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleOnGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET On');
    const switchMultilevelAttributes =
      await this.platform.smartRentApi.getState<SwitchMultilevelData>(
        this.state.hubId,
        this.state.deviceId
      );
    const levelAttribute = findStateByName(
      switchMultilevelAttributes,
      'level'
    ) as number;
    const level = Number(levelAttribute) > 0 ? 1 : 0;
    this.state.on.current = level;
    return level;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleOnSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET On:', value);
    this.state.on.target = value === true ? 1 : 0;
    const newAttributes = [{ name: 'level', state: value === true ? 100 : 0 }];
    const switchMultilevelAttributes =
      await this.platform.smartRentApi.setState<SwitchMultilevelData>(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );
    const levelAttribute = findStateByName(
      switchMultilevelAttributes,
      'level'
    ) as number;

    this.state.on.current = Number(levelAttribute) > 0 ? 1 : 0;
  }

  /**
   * Handle requests to get the current value of the "Brightness" characteristic
   */
  async handleBrightnessGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Brightness');
    const switchMultilevelAttributes =
      await this.platform.smartRentApi.getState(
        this.state.hubId,
        this.state.deviceId
      );
    const level = findStateByName(
      switchMultilevelAttributes,
      'level'
    ) as number;
    this.state.brightness.current = level;
    return level;
  }

  /**
   * Handle requests to set the "Brightness" characteristic
   */
  async handleBrightnessSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET Brightness:', value);
    this.state.brightness.target = value;
    const newAttributes = [{ name: 'level', state: Number(value) }];
    const switchMultilevelAttributes =
      await this.platform.smartRentApi.setState<SwitchMultilevelData>(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );
    this.state.brightness.current = findStateByName(
      switchMultilevelAttributes,
      'level'
    ) as number;
  }
}
