import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

export class MotionSensorAccessory {
  private readonly service: Service;

  private readonly state: {
    hubId: string;
    deviceId: string;
    motion: {
      current: CharacteristicValue;
    };
  };

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly accessory: SmartRentAccessory
  ) {
    const device = this.accessory.context.device;
    const initialMotion = findStateByName(device.attributes, 'motion_binary');
    const motion = initialMotion === 'true' || initialMotion === true;

    this.state = {
      hubId: device.room.hub_id.toString(),
      deviceId: device.id.toString(),
      motion: {
        current: motion,
      },
    };

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.MotionSensor) ||
      this.accessory.addService(this.platform.api.hap.Service.MotionSensor);

    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.MotionDetected)
      .onGet(this.handleMotionDetectedGet.bind(this));

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.StatusActive)
      .onGet(() => this.accessory.context.device.online);

    this.platform.smartRentApi.websocket.event[this.state.deviceId] = (
      event: WSEvent
    ) => this.handleDeviceStateChanged(event);
  }

  async handleMotionDetectedGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(
      `Triggered GET MotionDetected for "${this.accessory.context.device.name}" (${this.state.deviceId})`
    );
    return this.state.motion.current;
  }

  handleDeviceStateChanged(event: WSEvent) {
    const deviceName = this.accessory.context.device.name;
    this.platform.log.debug(
      `Device "${deviceName}" (${this.state.deviceId}) state changed: ${JSON.stringify(event)}`
    );

    if (event.name !== 'motion_binary') {
      return;
    }

    const motion = event.last_read_state === 'true';

    this.platform.log.debug(
      `Motion sensor "${deviceName}" websocket update: state="${event.last_read_state}", motion=${motion}`
    );

    this.state.motion.current = motion;
    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.MotionDetected,
      motion
    );
  }
}
