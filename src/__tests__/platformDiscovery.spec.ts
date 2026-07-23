import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// The real API client authenticates and opens a WebSocket on construction.
vi.mock('../lib/api.js', () => ({
  SmartRentApi: class {
    discoverDevices = vi.fn().mockResolvedValue([]);
    connect = vi.fn().mockResolvedValue(undefined);
    client = { getAccessToken: vi.fn().mockResolvedValue('token') };
    websocket = { subscribeDevice: vi.fn() };
  },
}));

import { SmartRentPlatform } from '../platform.js';
import type { API, Logger } from 'homebridge';
import type { SmartRentPlatformConfig } from '../lib/config.js';

/**
 * Device discovery runs once at launch today. These cover the rediscovery
 * loop that picks up devices added or removed in the SmartRent app, and the
 * reporting of device types the plugin does not yet handle.
 */

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeDevice(id: number, name: string, type = 'switch_binary') {
  return {
    id,
    name,
    type,
    room: { hub_id: 900 },
    attributes: [{ name: 'on', state: 'false' }],
  };
}

function makeApi(): {
  api: API;
  registered: unknown[];
  unregistered: unknown[];
  launch: () => Promise<void>;
} {
  const registered: unknown[] = [];
  const unregistered: unknown[] = [];
  let launchCb: () => Promise<void> = async () => {};

  class FakeAccessory {
    displayName: string;
    UUID: string;
    context: Record<string, unknown> = {};
    constructor(displayName: string, uuid: string) {
      this.displayName = displayName;
      this.UUID = uuid;
    }
    getService() {
      return undefined;
    }
    addService() {
      return {
        setCharacteristic() {
          return this;
        },
        getCharacteristic() {
          return { onGet: () => ({ onSet: () => undefined }) };
        },
      };
    }
  }

  const api = {
    hap: {
      uuid: { generate: (s: string) => `uuid-${s}` },
      Characteristic: new Proxy({}, { get: () => 'characteristic' }),
      Service: new Proxy({}, { get: () => 'service' }),
    },
    platformAccessory: FakeAccessory,
    user: { storagePath: () => '/tmp/smartrent-test' },
    on: (event: string, cb: () => Promise<void>) => {
      if (event === 'didFinishLaunching') {
        launchCb = cb;
      }
    },
    registerPlatformAccessories: (_p: string, _n: string, accs: unknown[]) => {
      registered.push(...accs);
    },
    unregisterPlatformAccessories: (
      _p: string,
      _n: string,
      accs: unknown[]
    ) => {
      unregistered.push(...accs);
    },
    updatePlatformAccessories: () => undefined,
  } as unknown as API;

  return { api, registered, unregistered, launch: () => launchCb() };
}

const config = {
  platform: 'SmartRent',
  email: 'u@example.com',
  password: 'p',
  enableSwitches: true,
  enableLocks: true,
} as SmartRentPlatformConfig;

/** Platform with the API layer and accessory construction stubbed out. */
function makePlatform(devices: unknown[]) {
  const harness = makeApi();
  const log = makeLogger();
  const platform = new SmartRentPlatform(log, config, harness.api);

  const discoverDevices = vi.fn().mockResolvedValue(devices);
  Object.defineProperty(platform, 'smartRentApi', {
    value: {
      discoverDevices,
      connect: vi.fn().mockResolvedValue(undefined),
      client: { getAccessToken: vi.fn().mockResolvedValue('token') },
      websocket: { subscribeDevice: vi.fn() },
    },
    writable: true,
  });

  // Accessory construction needs a full HAP surface; the reconcile logic is
  // what is under test.
  const build = vi.fn();
  Object.defineProperty(platform, '_buildAccessory', {
    value: build,
    writable: true,
  });

  return { platform, harness, log, discoverDevices, build };
}

describe('SmartRentPlatform device discovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('registers accessories found at launch', async () => {
    const { platform, harness } = makePlatform([makeDevice(1, 'Lamp')]);
    await platform.discoverDevices();
    expect(harness.registered).toHaveLength(1);
  });

  // A device added in the SmartRent app must reach HomeKit without a
  // Homebridge restart.
  it('registers a device added after launch', async () => {
    const { platform, harness, discoverDevices } = makePlatform([
      makeDevice(1, 'Lamp'),
    ]);
    await platform.discoverDevices();
    expect(harness.registered).toHaveLength(1);

    discoverDevices.mockResolvedValue([
      makeDevice(1, 'Lamp'),
      makeDevice(2, 'Fan'),
    ]);
    await platform.discoverDevices();

    expect(harness.registered).toHaveLength(2);
  });

  it('does not re-register a device already known', async () => {
    const { platform, harness } = makePlatform([makeDevice(1, 'Lamp')]);
    await platform.discoverDevices();
    await platform.discoverDevices();
    expect(harness.registered).toHaveLength(1);
  });

  // Accessory handlers subscribe to WebSocket device events through an
  // accumulating subscriber set, so constructing one twice for the same
  // accessory means every device event is handled twice, forever.
  it('builds the accessory handler once per accessory', async () => {
    const { platform, build } = makePlatform([makeDevice(1, 'Lamp')]);
    await platform.discoverDevices();
    await platform.discoverDevices();
    await platform.discoverDevices();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('unregisters a device removed from the account', async () => {
    const { platform, harness, discoverDevices } = makePlatform([
      makeDevice(1, 'Lamp'),
      makeDevice(2, 'Fan'),
    ]);
    await platform.discoverDevices();
    discoverDevices.mockResolvedValue([makeDevice(1, 'Lamp')]);
    await platform.discoverDevices();
    expect(harness.unregistered).toHaveLength(1);
  });

  // A discovery failure must not be read as "the account has no devices",
  // which would unregister every accessory the user has.
  it('does not unregister everything when discovery fails', async () => {
    const { platform, harness, discoverDevices } = makePlatform([
      makeDevice(1, 'Lamp'),
      makeDevice(2, 'Fan'),
    ]);
    await platform.discoverDevices();
    discoverDevices.mockRejectedValue(new Error('network down'));
    await platform.discoverDevices();
    expect(harness.unregistered).toHaveLength(0);
  });

  it('does not unregister everything when discovery returns nothing', async () => {
    const { platform, harness, discoverDevices } = makePlatform([
      makeDevice(1, 'Lamp'),
    ]);
    await platform.discoverDevices();
    discoverDevices.mockResolvedValue([]);
    await platform.discoverDevices();
    expect(harness.unregistered).toHaveLength(0);
  });

  // An unhandled device type is actionable information, not an error: the
  // plugin cannot support hardware it has never been told about.
  it('reports an unsupported device type once, as a warning', async () => {
    const { platform, log } = makePlatform([
      makeDevice(1, 'Gadget', 'brand_new_type'),
    ]);
    await platform.discoverDevices();
    await platform.discoverDevices();

    const warnings = (log.warn as unknown as { mock: { calls: string[][] } })
      .mock.calls;
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain('brand_new_type');
    expect(log.error).not.toHaveBeenCalled();
  });

  // A slow pass still holds the device list it fetched. If a second pass
  // starts and finishes meanwhile, the slow one's reconcile would work from
  // its stale snapshot and unregister whatever the fresh pass just added.
  it('does not let an overlapping pass unregister a newly added device', async () => {
    const { platform, harness, discoverDevices } = makePlatform([
      makeDevice(1, 'Lamp'),
    ]);
    await platform.discoverDevices();

    let releaseSlow: (v: unknown) => void = () => {};
    const slow = new Promise(resolve => {
      releaseSlow = resolve;
    });
    // The slow pass sees only the original device.
    discoverDevices.mockImplementationOnce(async () => {
      await slow;
      return [makeDevice(1, 'Lamp')];
    });
    const slowRun = platform.discoverDevices();

    // A second pass starts while the first is still fetching, and observes
    // the newly added device.
    discoverDevices.mockResolvedValue([
      makeDevice(1, 'Lamp'),
      makeDevice(2, 'Fan'),
    ]);
    const secondRun = platform.discoverDevices();

    releaseSlow(undefined);
    await Promise.all([slowRun, secondRun]);

    // The stale snapshot must not remove what the newer pass registered.
    expect(harness.unregistered).toHaveLength(0);
    expect(platform.accessories.map(a => a.UUID)).toContain('uuid-2');
  });

  // Handlers cannot be unsubscribed (the websocket event setter appends to
  // an accumulating set), so a device that disappears and comes back must
  // not be given a second handler.
  it('does not rebuild a handler for a device that flaps out and back', async () => {
    const { platform, build, discoverDevices } = makePlatform([
      makeDevice(1, 'Lamp'),
      makeDevice(2, 'Fan'),
    ]);
    await platform.discoverDevices();
    expect(build).toHaveBeenCalledTimes(2);

    discoverDevices.mockResolvedValue([makeDevice(1, 'Lamp')]);
    await platform.discoverDevices();

    discoverDevices.mockResolvedValue([
      makeDevice(1, 'Lamp'),
      makeDevice(2, 'Fan'),
    ]);
    await platform.discoverDevices();

    expect(build).toHaveBeenCalledTimes(2);
  });

  it('rediscovers devices on an interval', async () => {
    const { platform, discoverDevices } = makePlatform([makeDevice(1, 'Lamp')]);
    await platform.startDeviceDiscovery();
    expect(discoverDevices).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(discoverDevices).toHaveBeenCalledTimes(2);
  });

  it('stops rediscovery on shutdown', async () => {
    const { platform, discoverDevices } = makePlatform([makeDevice(1, 'Lamp')]);
    await platform.startDeviceDiscovery();
    platform.stopDeviceDiscovery();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(discoverDevices).toHaveBeenCalledTimes(1);
  });
});
