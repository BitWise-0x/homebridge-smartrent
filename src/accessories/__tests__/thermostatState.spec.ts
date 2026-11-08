import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThermostatAccessory } from '../thermostat.js';
import type { SmartRentPlatform } from '../../platform.js';
import type { SmartRentAccessory } from '../index.js';

/**
 * These tests exercise the real ThermostatAccessory against a stubbed Homebridge
 * API so the promise wiring in _getState() is covered. A reimplementation of the
 * caching logic would not catch an unhandled rejection, since the defect is in
 * how the promise chain is built rather than in any value it produces.
 */

const Characteristic = {
  SerialNumber: 'SerialNumber',
  Name: 'Name',
  StatusActive: 'StatusActive',
  CurrentHeatingCoolingState: 'CurrentHeatingCoolingState',
  TargetHeatingCoolingState: 'TargetHeatingCoolingState',
  CurrentTemperature: 'CurrentTemperature',
  TargetTemperature: 'TargetTemperature',
  TemperatureDisplayUnits: {
    CELSIUS: 0,
    FAHRENHEIT: 1,
  },
  CurrentRelativeHumidity: 'CurrentRelativeHumidity',
  CoolingThresholdTemperature: 'CoolingThresholdTemperature',
  HeatingThresholdTemperature: 'HeatingThresholdTemperature',
  On: 'On',
  ConfiguredName: 'ConfiguredName',
};

const Service = {
  AccessoryInformation: 'AccessoryInformation',
  Thermostat: 'Thermostat',
  Fan: 'Fan',
};

function createCharacteristicStub() {
  const stub = {
    onGet: vi.fn(() => stub),
    onSet: vi.fn(() => stub),
    setProps: vi.fn(() => stub),
    updateValue: vi.fn(() => stub),
  };
  return stub;
}

function createServiceStub() {
  const stub = {
    setCharacteristic: vi.fn(() => stub),
    getCharacteristic: vi.fn(() => createCharacteristicStub()),
    updateCharacteristic: vi.fn(() => stub),
    addOptionalCharacteristic: vi.fn(() => stub),
  };
  return stub;
}

const THERMOSTAT_ATTRIBUTES = [
  { name: 'mode', state: 'cool' },
  { name: 'operating_state', state: 'cooling' },
  { name: 'current_temp', state: '67' },
  { name: 'current_humidity', state: '50' },
  { name: 'cooling_setpoint', state: '67' },
  { name: 'heating_setpoint', state: '70' },
  { name: 'fan_mode', state: 'auto' },
];

/**
 * Node reports unhandled rejections once the microtask queue has drained and the
 * event loop has turned, so give it a couple of macrotask ticks to fire.
 */
async function flushRejections() {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function createHarness(getState: () => Promise<unknown>) {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
  };

  const platform = {
    log,
    config: { temperatureUnit: 'fahrenheit' },
    api: { hap: { Characteristic, Service } },
    smartRentApi: {
      getState: vi.fn(getState),
      setState: vi.fn(async () => THERMOSTAT_ATTRIBUTES),
      websocket: { event: {} as Record<string, unknown> },
    },
  } as unknown as SmartRentPlatform;

  const accessory = {
    context: {
      device: {
        id: 3636398,
        name: 'Thermostat',
        online: true,
        room: { hub_id: 675084 },
        attributes: THERMOSTAT_ATTRIBUTES,
      },
    },
    getService: vi.fn(() => createServiceStub()),
    addService: vi.fn(() => createServiceStub()),
  } as unknown as SmartRentAccessory;

  return { platform, accessory, log };
}

describe('ThermostatAccessory state fetching', () => {
  let unhandled: unknown[];
  let onUnhandled: (reason: unknown) => void;

  beforeEach(() => {
    unhandled = [];
    onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  it('does not emit an unhandled rejection when the state request fails', async () => {
    const timeout = Object.assign(new Error('timeout of 10000ms exceeded'), {
      code: 'ETIMEDOUT',
    });
    const { platform, accessory } = createHarness(() =>
      Promise.reject(timeout)
    );
    const thermostat = new ThermostatAccessory(platform, accessory);

    // Mirrors HomeKit issuing several characteristic reads at once, which all
    // dedupe onto a single in-flight request.
    await Promise.all([
      thermostat.handleCurrentHeatingCoolingStateGet(),
      thermostat.handleCurrentTemperatureGet(),
      thermostat.handleCoolingThresholdTemperatureGet(),
      thermostat.handleHeatingThresholdTemperatureGet(),
    ]);

    // Let any orphaned promise chain settle and report.
    await flushRejections();

    expect(unhandled).toEqual([]);
  });

  it('dedupes concurrent reads onto a single API request', async () => {
    const { platform, accessory } = createHarness(async () => [
      ...THERMOSTAT_ATTRIBUTES,
    ]);
    const thermostat = new ThermostatAccessory(platform, accessory);

    await Promise.all([
      thermostat.handleCurrentHeatingCoolingStateGet(),
      thermostat.handleCurrentTemperatureGet(),
      thermostat.handleCoolingThresholdTemperatureGet(),
      thermostat.handleHeatingThresholdTemperatureGet(),
    ]);

    expect(platform.smartRentApi.getState).toHaveBeenCalledTimes(1);
  });

  it('serves a successful result from cache on subsequent reads', async () => {
    const { platform, accessory } = createHarness(async () => [
      ...THERMOSTAT_ATTRIBUTES,
    ]);
    const thermostat = new ThermostatAccessory(platform, accessory);

    await thermostat.handleCurrentTemperatureGet();
    await thermostat.handleCurrentTemperatureGet();

    expect(platform.smartRentApi.getState).toHaveBeenCalledTimes(1);
  });

  it('retries the API after a failure instead of serving a cached rejection', async () => {
    let calls = 0;
    const { platform, accessory } = createHarness(() => {
      calls++;
      if (calls === 1) {
        return Promise.reject(new Error('timeout of 10000ms exceeded'));
      }
      return Promise.resolve(THERMOSTAT_ATTRIBUTES);
    });
    const thermostat = new ThermostatAccessory(platform, accessory);

    await thermostat.handleCurrentTemperatureGet();
    await flushRejections();

    // A failed lookup must not be cached; the next read should hit the API again
    // and return the real value rather than the stale constructor default.
    const value = await thermostat.handleCurrentTemperatureGet();

    expect(calls).toBe(2);
    expect(value).toBe(19.4);
  });
});
