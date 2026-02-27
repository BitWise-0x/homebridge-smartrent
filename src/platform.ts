import { API, DynamicPlatformPlugin, Logger } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import {
  AccessoryContext,
  SmartRentAccessory,
  LockAccessory,
  LeakSensorAccessory,
  MotionSensorAccessory,
  SwitchAccessory,
  ThermostatAccessory,
  SwitchMultilevelAccessory,
} from './accessories/index.js';
import { SmartRentApi } from './lib/api.js';
import { DeviceDataUnion } from './devices/index.js';
import { SmartRentPlatformConfig } from './lib/config.js';

/**
 * SmartRentPlatform
 */
export class SmartRentPlatform implements DynamicPlatformPlugin {
  public readonly smartRentApi: SmartRentApi;
  public accessories: SmartRentAccessory[] = [];

  private readonly ALLOWED_DEVICE_TYPES: Set<string> = new Set([
    'sensor_notification',
    'entry_control',
    'switch_binary',
    'thermostat',
    'switch_multilevel',
  ]);

  constructor(
    public readonly log: Logger,
    public readonly config: SmartRentPlatformConfig,
    public readonly api: API
  ) {
    if (this.config.verboseLogging) {
      log.debug = log.info.bind(log);
      log.info('Verbose logging enabled');
    }

    log.debug(`Initializing ${this.config.platform} platform`);
    this.smartRentApi = new SmartRentApi(this);
    log.debug('Finished initializing platform:', this.config.platform);

    this.api.on('didFinishLaunching', async () => {
      try {
        if (await this.smartRentApi.client.getAccessToken()) {
          await this.discoverDevices();
        }
      } catch (error) {
        log.error('Failed to initialize SmartRent platform:', error);
      }
      log.debug('Executed didFinishLaunching callback');
    });
  }

  configureAccessory(accessory: SmartRentAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  private _initAccessory(
    uuid: string,
    device: DeviceDataUnion,
    accessory?: SmartRentAccessory
  ) {
    // create the accessory handler for the restored accessory
    // this is imported from `platformAccessory.ts`
    let Accessory:
      | typeof LeakSensorAccessory
      | typeof LockAccessory
      | typeof MotionSensorAccessory
      | typeof SwitchAccessory
      | typeof ThermostatAccessory
      | typeof SwitchMultilevelAccessory;

    const type = device.type;
    if (!this.ALLOWED_DEVICE_TYPES.has(type)) {
      this.log.error(`Unknown device type: ${device.type}`);
      return;
    }
    const attributeNames = device.attributes.map(attr => {
      return attr.name;
    });
    if (
      type === 'sensor_notification' &&
      attributeNames.includes('leak') &&
      this.config.enableLeakSensors
    ) {
      Accessory = LeakSensorAccessory;
    } else if (
      type === 'sensor_notification' &&
      attributeNames.includes('motion_binary') &&
      this.config.enableMotionSensors
    ) {
      Accessory = MotionSensorAccessory;
    } else if (type === 'entry_control' && this.config.enableLocks) {
      Accessory = LockAccessory;
    } else if (type === 'switch_binary' && this.config.enableSwitches) {
      Accessory = SwitchAccessory;
    } else if (type === 'thermostat' && this.config.enableThermostats) {
      Accessory = ThermostatAccessory;
    } else if (
      type === 'switch_multilevel' &&
      this.config.enableSwitchMultiLevels
    ) {
      Accessory = SwitchMultilevelAccessory;
    } else {
      this.log.info(`Disabled device type: ${device.type}`);
      return;
    }

    // Create the accessory if it doesn't already exist
    let accessoryExists = true;
    if (accessory) {
      // the accessory already exists
      this.log.info(
        'Restoring existing accessory from cache:',
        accessory.displayName
      );
      accessory.context.device = device;
      this.api.updatePlatformAccessories([accessory]);
    } else {
      accessoryExists = false;
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', device.name);
      // create a new accessory
      accessory = new this.api.platformAccessory<AccessoryContext>(
        device.name,
        uuid
      );
      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
    }

    // create the accessory handler for the newly create accessory
    // this is imported from `platformAccessory.ts`
    new Accessory(this, accessory); //NOSONAR

    if (!accessoryExists) {
      this.accessories.push(accessory);
      // link the accessory to the platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    }
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    const allDevices = await this.smartRentApi.discoverDevices();
    const excludeIds = new Set(this.config.excludeDevices ?? []);
    const devices = allDevices.filter(device => {
      if (excludeIds.has(device.id)) {
        this.log.info(`Excluding device: ${device.name} (${device.id})`);
        return false;
      }
      return true;
    });

    // loop over the discovered devices and register each one if it has not already been registered
    const uuids = devices.map(device => {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.id.toString());
      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(
        accessory => accessory.UUID === uuid
      );
      this._initAccessory(uuid, device, existingAccessory);
      return uuid;
    });

    // remove platform accessories when no longer present
    this.accessories = this.accessories.filter(existingAccessory => {
      if (!uuids.includes(existingAccessory.UUID)) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          existingAccessory,
        ]);
        this.log.info(
          'Removing existing accessory from cache:',
          existingAccessory.displayName
        );
        return false;
      }
      return true;
    });
  }
}
