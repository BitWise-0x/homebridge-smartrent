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

/** How often to look for devices added or removed in the SmartRent app. */
const DISCOVERY_INTERVAL_MS = 15 * 60 * 1000;

type AccessoryConstructor =
  | typeof LeakSensorAccessory
  | typeof LockAccessory
  | typeof MotionSensorAccessory
  | typeof SwitchAccessory
  | typeof ThermostatAccessory
  | typeof SwitchMultilevelAccessory;

/**
 * SmartRentPlatform
 */
export class SmartRentPlatform implements DynamicPlatformPlugin {
  public readonly smartRentApi: SmartRentApi;
  public accessories: SmartRentAccessory[] = [];

  private _discoveryTimer?: ReturnType<typeof setInterval>;
  private _discoveryChain?: Promise<void>;
  // Accessories whose handler has been attached, so repeated discovery
  // passes never build a second handler for the same accessory.
  private readonly _handledUUIDs = new Set<string>();
  // Accessory handlers by UUID, so resources they own (the lock auto-relock
  // timer in particular) can be released when a device is removed.
  private readonly _handlers = new Map<string, { dispose?: () => void }>();
  // Unsupported device types already reported, so the warning fires once per
  // type rather than on every discovery pass.
  private readonly _reportedUnknownTypes = new Set<string>();

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
          try {
            await this.smartRentApi.connect();
          } catch (wsError) {
            log.warn(
              'WebSocket connection failed — will retry in background:',
              wsError
            );
          }
          await this.startDeviceDiscovery();
        }
      } catch (error) {
        log.error('Failed to initialize SmartRent platform:', error);
      }
      log.debug('Executed didFinishLaunching callback');
    });

    this.api.on('shutdown', () => this.stopDeviceDiscovery());
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
    let Accessory: AccessoryConstructor;

    const type = device.type;
    if (!this.ALLOWED_DEVICE_TYPES.has(type)) {
      // SmartRent adds hardware categories over time. This is not an error in
      // the user's setup, and repeating it on every discovery pass would be
      // noise, so report each unknown type once with a way to get it added.
      if (!this._reportedUnknownTypes.has(type)) {
        this._reportedUnknownTypes.add(type);
        this.log.warn(
          `Device "${device.name}" reports an unsupported type "${type}" and ` +
            'was not added to HomeKit. Please report this type so support ' +
            'can be added: ' +
            'https://github.com/BitWise-0x/homebridge-smartrent/issues'
        );
      }
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
      this.log.debug(
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

    // Attach the accessory handler exactly once. It registers HAP
    // characteristic handlers and subscribes to WebSocket device events
    // through an accumulating subscriber set, so building it again on a
    // later discovery pass would handle every event twice over.
    if (!this._handledUUIDs.has(uuid)) {
      this._handledUUIDs.add(uuid);
      const handler = this._buildAccessory(Accessory, accessory);
      if (handler) {
        this._handlers.set(uuid, handler);
      }
    }

    if (!accessoryExists) {
      this.accessories.push(accessory);
      // link the accessory to the platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    }
  }

  /**
   * Attach the accessory handler. Isolated so the discovery/reconcile logic
   * can be tested without a full HAP implementation.
   */
  protected _buildAccessory(
    Accessory: AccessoryConstructor,
    accessory: SmartRentAccessory
  ): { dispose?: () => void } | undefined {
    return new Accessory(this, accessory) as { dispose?: () => void }; //NOSONAR
  }

  /**
   * Begin periodic device discovery. Devices added or removed in the
   * SmartRent app are picked up on the next pass rather than waiting for a
   * Homebridge restart.
   */
  async startDeviceDiscovery(): Promise<void> {
    // Clear first: a second call must not leave the previous interval
    // running untracked.
    this.stopDeviceDiscovery();
    await this.discoverDevices();
    this._discoveryTimer = setInterval(() => {
      this.discoverDevices().catch(error =>
        this.log.warn('Device rediscovery failed:', error)
      );
    }, DISCOVERY_INTERVAL_MS);
    // Don't hold the event loop open on shutdown.
    this._discoveryTimer.unref?.();
  }

  stopDeviceDiscovery(): void {
    if (this._discoveryTimer) {
      clearInterval(this._discoveryTimer);
      this._discoveryTimer = undefined;
    }
  }

  async discoverDevices() {
    // A slow pass would reconcile against the device list it fetched before
    // a newer pass ran, unregistering anything the newer pass added. Run one
    // at a time, and chain onto the in-flight pass so a caller still sees a
    // complete, up-to-date discovery rather than a silently dropped one.
    const run = (this._discoveryChain ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this._discoverDevices());
    this._discoveryChain = run;
    try {
      await run;
    } finally {
      if (this._discoveryChain === run) {
        this._discoveryChain = undefined;
      }
    }
  }

  private async _discoverDevices() {
    let allDevices: DeviceDataUnion[];
    try {
      allDevices = await this.smartRentApi.discoverDevices();
    } catch (error) {
      // A failed request is not evidence that the account has no devices;
      // treating it as such would unregister every accessory the user has.
      this.log.warn('Device discovery failed, keeping known devices:', error);
      return;
    }

    // Likewise an empty result. discoverDevices() returns [] for a missing
    // unit or hub, which is a transient/config condition rather than a real
    // "all devices deleted" event.
    if (allDevices.length === 0) {
      if (this.accessories.length > 0) {
        this.log.warn(
          'Device discovery returned no devices; keeping existing accessories'
        );
      }
      return;
    }

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
    const activeUUIDs = new Set(uuids);
    this.accessories = this.accessories.filter(existingAccessory => {
      if (!activeUUIDs.has(existingAccessory.UUID)) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          existingAccessory,
        ]);
        this.log.info(
          'Removing existing accessory from cache:',
          existingAccessory.displayName
        );
        // Release anything the handler owns (the auto-relock timer would
        // otherwise still fire against a removed door).
        this._handlers.get(existingAccessory.UUID)?.dispose?.();
        // Deliberately NOT removed from _handledUUIDs. There is no way to
        // unsubscribe a handler (websocket.event[id] = fn appends to an
        // accumulating set), so a device that flaps out of the API response
        // and back would get a second handler and fire every event twice.
        // The original handler is still attached and still correct.
        return false;
      }
      return true;
    });
  }
}
