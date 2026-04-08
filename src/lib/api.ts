import axios from 'axios';
import { SmartRentPlatform } from '../platform.js';
import { SmartRentApiClient, SmartRentWebsocketClient } from './client.js';
import {
  BaseDeviceResponse,
  DeviceAttribute,
  DeviceDataUnion,
} from '../devices/index.js';

// Network-level error codes that indicate the request never reached the
// server (or the response never came back). Safe to retry writes on these.
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
]);

function isTransientNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  // A response means the server acted on the request — never retry.
  if (err.response) return false;
  return !!err.code && TRANSIENT_NETWORK_CODES.has(err.code);
}

type UnitData = {
  building: string;
  city: string;
  country: string | null;
  floor: string;
  group: {
    city: string;
    country: string;
    group_white_label_config: null;
    id: number;
    marketing_name: string;
    organization_id: number;
    parking_enabled: false;
    property_code: string;
    rentcafe_id: null;
    state: string;
    store_url: null;
    street_address_1: string;
    street_address_2: string;
    sync_interval: number;
    temperature_scale: string;
    timezone: string;
    uuid: string;
    zip: string;
  };
  group_id: number;
  has_hub: boolean;
  hub: {
    connected_to_community_wifi: boolean;
    connection: string;
    firmware: string;
    hub_account_id: number;
    id: number;
    online: number;
    serial: string;
    timezone: null;
    type: string;
    unit_id: number;
    wifi_supported: boolean;
  };
  hub_id: number;
  id: number;
  image_url: string;
  marketing_name: string;
  parking_enabled: boolean;
  portal_only: boolean;
  ring_enabled: boolean;
  state: string;
  street_address_1: string;
  street_address_2: string;
  temperature_scale: string;
  timezone: string;
  unit_code: string;
  zip: string;
};

type UnitRecords = {
  current_page: 1;
  records: UnitData[];
  total_pages: 1;
  total_records: 1;
};

export class SmartRentApi {
  public readonly client: SmartRentApiClient;
  public readonly websocket: SmartRentWebsocketClient;

  constructor(private readonly platform: SmartRentPlatform) {
    this.client = new SmartRentApiClient(platform);
    this.websocket = new SmartRentWebsocketClient(platform);
  }

  /**
   * Connect the WebSocket client after authentication is established
   */
  public async connect(): Promise<void> {
    await this.websocket.connect();
  }

  public async discoverDevices() {
    const unitRecords = await this.client.get<UnitRecords>('/units');
    const unitRecordsData = unitRecords.records;
    // Get either the specified unit or the first one
    const unitName = this.platform.config.unitName;
    const unitData = unitName
      ? unitRecordsData.find(unit => unit.marketing_name === unitName)
      : unitRecordsData[0];
    if (!unitData) {
      this.platform.log.error(`Unit ${unitName} not found`);
      return [];
    }

    // Get the unit's hub
    const hubId = unitData.hub_id;
    if (!hubId) {
      this.platform.log.error('No SmartRent hub found');
      return [];
    }

    // Get the devices in the hub
    const devices = await this.client.get<Array<DeviceDataUnion>>(
      `/hubs/${hubId}/devices`
    );
    this.platform.log.info('Devices Found: ', devices);

    if (devices.length) {
      this.platform.log.info(`Found ${devices.length} devices`);
    } else {
      this.platform.log.error('No devices found');
    }

    for (const device of devices) {
      this.platform.log.debug('device: ', device);
      await this.websocket.subscribeDevice(device.id);
    }

    return devices;
  }

  public async getState<Device extends BaseDeviceResponse>(
    hubId: string,
    deviceId: string
  ) {
    const device = await this.client.get<Device>(
      `/hubs/${hubId}/devices/${deviceId}`
    );
    this.platform.log.debug('device: ', device);
    return device.attributes;
  }

  public async getData<Device extends BaseDeviceResponse>(
    hubId: string,
    deviceId: string
  ) {
    const device = await this.client.get<Device>(
      `/hubs/${hubId}/devices/${deviceId}`
    );
    this.platform.log.debug('getData: ', device);
    return device;
  }

  public async setState<Device extends BaseDeviceResponse>(
    hubId: string,
    deviceId: string,
    attributes: Array<DeviceAttribute>
  ) {
    const normalizedAttributes = attributes.map(attribute => {
      if (
        typeof attribute.state === 'boolean' ||
        typeof attribute.state === 'number'
      ) {
        return { name: attribute.name, state: attribute.state.toString() };
      }
      return attribute;
    });
    const path = `/hubs/${hubId}/devices/${deviceId}`;
    const body = { attributes: normalizedAttributes };
    let device: Device;
    try {
      device = await this.client.patch<Device>(path, body);
    } catch (err) {
      if (!isTransientNetworkError(err)) throw err;
      this.platform.log.warn(
        `setState: transient network error on PATCH ${path}, retrying once on a fresh socket`
      );
      await new Promise(resolve => setTimeout(resolve, 250));
      // Force a fresh TCP+TLS connection for the retry. SmartRent's API
      // occasionally hangs on a keep-alive socket that was just used for a
      // GET; Connection: close bypasses the pool so the retry opens a new one.
      device = await this.client.patch<Device>(path, body, {
        headers: { Connection: 'close' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
    return device.attributes;
  }
}
