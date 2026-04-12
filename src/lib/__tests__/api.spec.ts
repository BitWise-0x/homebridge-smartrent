import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    isAxiosError: vi.fn(
      (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e)
    ),
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    })),
  },
}));

vi.mock('../auth.js', () => {
  const M = class {
    getAccessToken = vi.fn().mockResolvedValue('test-token');
    getWebSocketToken = vi.fn().mockResolvedValue('ws-token');
    clearAccessToken = vi.fn().mockResolvedValue(undefined);
    clearWebSocketToken = vi.fn().mockResolvedValue(undefined);
  };
  return { SmartRentAuthClient: M };
});

vi.mock('ws', () => {
  const WS = vi.fn();
  (WS as Record<string, unknown>).OPEN = 1;
  return { default: WS };
});

import axios from 'axios';
import { SmartRentApi } from '../api.js';

function createMockPlatform() {
  return {
    config: {
      email: 'a@b.com',
      password: 'pass',
      tfaSecret: 'secret',
      unitName: undefined as string | undefined,
    },
    api: {
      user: { storagePath: () => '/tmp/hb' },
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown;
}

describe('SmartRentApi', () => {
  let platform: ReturnType<typeof createMockPlatform>;

  beforeEach(() => {
    vi.clearAllMocks();
    platform = createMockPlatform();
  });

  describe('discoverDevices', () => {
    it('calls GET /units, selects unit by unitName config, extracts hub_id', async () => {
      platform.config.unitName = 'Unit B';
      const api = new SmartRentApi(platform);

      vi.spyOn(api.client, 'get')
        .mockResolvedValueOnce({
          records: [
            { marketing_name: 'Unit A', hub_id: 1 },
            { marketing_name: 'Unit B', hub_id: 2 },
          ],
        })
        .mockResolvedValueOnce([{ id: 100, name: 'Lock' }]);

      vi.spyOn(api.websocket, 'subscribeDevice').mockResolvedValue(undefined);

      const devices = await api.discoverDevices();

      expect(api.client.get).toHaveBeenCalledWith('/units');
      expect(api.client.get).toHaveBeenCalledWith('/hubs/2/devices');
      expect(devices).toEqual([{ id: 100, name: 'Lock' }]);
    });

    it('uses first unit when no unitName configured', async () => {
      platform.config.unitName = undefined;
      const api = new SmartRentApi(platform);

      vi.spyOn(api.client, 'get')
        .mockResolvedValueOnce({
          records: [
            { marketing_name: 'First', hub_id: 10 },
            { marketing_name: 'Second', hub_id: 20 },
          ],
        })
        .mockResolvedValueOnce([{ id: 200, name: 'Thermostat' }]);

      vi.spyOn(api.websocket, 'subscribeDevice').mockResolvedValue(undefined);

      const devices = await api.discoverDevices();

      expect(api.client.get).toHaveBeenCalledWith('/hubs/10/devices');
      expect(devices).toHaveLength(1);
    });

    it('returns empty array and logs error when hub_id is missing', async () => {
      const api = new SmartRentApi(platform);

      vi.spyOn(api.client, 'get').mockResolvedValueOnce({
        records: [{ marketing_name: 'Unit', hub_id: null }],
      });

      const devices = await api.discoverDevices();

      expect(platform.log.error).toHaveBeenCalledWith('No SmartRent hub found');
      expect(devices).toEqual([]);
    });
  });

  describe('setState', () => {
    it('normalizes boolean attributes to strings via .toString()', async () => {
      const api = new SmartRentApi(platform);
      vi.spyOn(api.client, 'patch').mockResolvedValue({
        attributes: [{ name: 'locked', state: 'true' }],
      });

      const result = await api.setState('1', '2', [
        { name: 'locked', state: true },
      ]);

      expect(api.client.patch).toHaveBeenCalledWith('/hubs/1/devices/2', {
        attributes: [{ name: 'locked', state: 'true' }],
      });
      expect(result).toEqual([{ name: 'locked', state: 'true' }]);
    });

    it('normalizes number attributes to strings via .toString()', async () => {
      const api = new SmartRentApi(platform);
      vi.spyOn(api.client, 'patch').mockResolvedValue({
        attributes: [{ name: 'level', state: '75' }],
      });

      await api.setState('1', '2', [{ name: 'level', state: 75 }]);

      expect(api.client.patch).toHaveBeenCalledWith('/hubs/1/devices/2', {
        attributes: [{ name: 'level', state: '75' }],
      });
    });

    it('retries on transient ECONNRESET with Connection: close header', async () => {
      const api = new SmartRentApi(platform);
      const transientError = {
        isAxiosError: true,
        code: 'ECONNRESET',
        response: undefined,
      };
      (axios.isAxiosError as ReturnType<typeof vi.fn>).mockImplementation(
        (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e)
      );

      vi.spyOn(api.client, 'patch')
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({
          attributes: [{ name: 'locked', state: 'true' }],
        });

      const result = await api.setState('1', '2', [
        { name: 'locked', state: 'true' },
      ]);

      expect(api.client.patch).toHaveBeenCalledTimes(2);
      const secondCall = (api.client.patch as ReturnType<typeof vi.fn>).mock
        .calls[1];
      expect(secondCall[2]).toEqual(
        expect.objectContaining({ headers: { Connection: 'close' } })
      );
      expect(result).toEqual([{ name: 'locked', state: 'true' }]);
    });

    it('does not retry non-transient errors', async () => {
      const api = new SmartRentApi(platform);
      const nonTransientError = new Error('Server Error');
      (nonTransientError as Record<string, unknown>).isAxiosError = true;
      (nonTransientError as Record<string, unknown>).response = { status: 500 };
      (axios.isAxiosError as ReturnType<typeof vi.fn>).mockImplementation(
        (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e)
      );

      vi.spyOn(api.client, 'patch').mockRejectedValue(nonTransientError);

      await expect(
        api.setState('1', '2', [{ name: 'locked', state: 'true' }])
      ).rejects.toThrow('Server Error');

      expect(api.client.patch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getState', () => {
    it('returns only attributes from response', async () => {
      const api = new SmartRentApi(platform);
      vi.spyOn(api.client, 'get').mockResolvedValue({
        id: 1,
        name: 'Lock',
        attributes: [{ name: 'locked', state: 'true' }],
      });

      const result = await api.getState('1', '2');

      expect(result).toEqual([{ name: 'locked', state: 'true' }]);
    });
  });

  describe('isTransientNetworkError (indirectly)', () => {
    it('ETIMEDOUT without response is treated as transient', async () => {
      const api = new SmartRentApi(platform);
      const transientError = {
        isAxiosError: true,
        code: 'ETIMEDOUT',
        response: undefined,
      };
      (axios.isAxiosError as ReturnType<typeof vi.fn>).mockImplementation(
        (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e)
      );

      vi.spyOn(api.client, 'patch')
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({
          attributes: [{ name: 'on', state: 'true' }],
        });

      const result = await api.setState('1', '2', [
        { name: 'on', state: 'true' },
      ]);

      expect(api.client.patch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([{ name: 'on', state: 'true' }]);
    });

    it('AxiosError with response is NOT transient (not retried)', async () => {
      const api = new SmartRentApi(platform);
      const errorWithResponse = {
        isAxiosError: true,
        code: 'ECONNRESET',
        response: { status: 502, data: {} },
        message: 'Bad Gateway',
      };
      (axios.isAxiosError as ReturnType<typeof vi.fn>).mockImplementation(
        (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e)
      );

      vi.spyOn(api.client, 'patch').mockRejectedValue(errorWithResponse);

      await expect(
        api.setState('1', '2', [{ name: 'on', state: 'true' }])
      ).rejects.toBe(errorWithResponse);

      expect(api.client.patch).toHaveBeenCalledTimes(1);
    });
  });
});
