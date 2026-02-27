import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { SwitchData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

/**
 * Switch Accessory
 * An instance of this class is created for each accessory the platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SwitchAccessory {
  private readonly service: Service;

  private readonly state: {
    hubId: string;
    deviceId: string;
    on: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
  };

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly accessory: SmartRentAccessory
  ) {
    const device = this.accessory.context.device;
    const initialOn = findStateByName(device.attributes, 'on');
    const isOn = initialOn === 'true' || initialOn === true || initialOn === 1;

    this.state = {
      hubId: device.room.hub_id.toString(),
      deviceId: device.id.toString(),
      on: {
        current: isOn ? 1 : 0,
        target: isOn ? 1 : 0,
      },
    };

    // set accessory information
    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    // get the Switch service if it exists, otherwise create a new Switch service
    this.service =
      this.accessory.getService(this.platform.api.hap.Service.Switch) ||
      this.accessory.addService(this.platform.api.hap.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.StatusActive)
      .onGet(() => this.accessory.context.device.online);

    // create handlers for required characteristics
    // see https://developers.homebridge.io/#/service/Switch
    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    // subscribe to device state changed events
    this.platform.smartRentApi.websocket.event[this.state.deviceId] = (
      event: WSEvent
    ) => this.handleDeviceStateChanged(event);
  }

  /**
   * Handle device state changed events
   */
  async handleDeviceStateChanged(event: WSEvent) {
    this.platform.log.debug('Received websocket Switch event:', event);
    if (event.name !== 'on') {
      return;
    }

    this.state.on.current = event.last_read_state === 'true' ? 1 : 0;
    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      this.state.on.current
    );
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleOnGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET On');
    return this.state.on.current;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleOnSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET On:', value);
    this.state.on.target = value;
    const newAttributes = [{ name: 'on', state: !!value }];
    const switchAttributes =
      await this.platform.smartRentApi.setState<SwitchData>(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );
    const on = findStateByName(switchAttributes, 'on') as boolean;
    this.state.on.current = on ? 1 : 0;
  }
}
