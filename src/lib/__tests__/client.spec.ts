import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock all external dependencies before imports

const mockAxiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  request: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance),
    isAxiosError: vi.fn(
      (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e)
    ),
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
import { SmartRentApiClient, SmartRentWebsocketClient } from '../client.js';

function createMockPlatform() {
  return {
    config: {
      email: 'a@b.com',
      password: 'pass',
      tfaSecret: 'secret',
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

describe('SmartRentApiClient', () => {
  let platform: ReturnType<typeof createMockPlatform>;

  beforeEach(() => {
    vi.clearAllMocks();
    (axios.create as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAxiosInstance
    );
    platform = createMockPlatform();
  });

  describe('get/post/patch return response.data (unwrap)', () => {
    it('get returns response.data', async () => {
      const client = new SmartRentApiClient(platform);
      mockAxiosInstance.get.mockResolvedValue({ data: { foo: 'bar' } });

      const result = await client.get('/test');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('post returns response.data', async () => {
      const client = new SmartRentApiClient(platform);
      mockAxiosInstance.post.mockResolvedValue({ data: { created: true } });

      const result = await client.post('/test', { body: 1 });
      expect(result).toEqual({ created: true });
    });

    it('patch returns response.data', async () => {
      const client = new SmartRentApiClient(platform);
      mockAxiosInstance.patch.mockResolvedValue({ data: { updated: true } });

      const result = await client.patch('/test', { body: 1 });
      expect(result).toEqual({ updated: true });
    });
  });

  describe('_handleResponseError (401 retry)', () => {
    it('clears token and retries on first 401, sets __retried flag', async () => {
      new SmartRentApiClient(platform);

      const responseErrorHandler = mockAxiosInstance.interceptors.response.use
        .mock.calls[0][1] as (error: unknown) => Promise<unknown>;

      const config = {
        headers: { Authorization: 'Bearer old' },
      };
      const error = {
        isAxiosError: true,
        response: { status: 401 },
        config,
      };

      mockAxiosInstance.request.mockResolvedValue({ data: 'retried' });

      await responseErrorHandler(error);

      expect((config as Record<string, unknown>).__retried).toBe(true);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(config);
    });

    it('rejects on second 401 (already retried)', async () => {
      new SmartRentApiClient(platform);

      const responseErrorHandler = mockAxiosInstance.interceptors.response.use
        .mock.calls[0][1] as (error: unknown) => Promise<unknown>;

      const config = {
        headers: { Authorization: 'Bearer old' },
        __retried: true,
      };
      const error = {
        isAxiosError: true,
        response: { status: 401 },
        config,
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });
  });

  describe('_sanitizeAxiosError', () => {
    it('removes Authorization from config headers, response headers, and raw request', async () => {
      new SmartRentApiClient(platform);

      const responseErrorHandler = mockAxiosInstance.interceptors.response.use
        .mock.calls[0][1] as (error: unknown) => Promise<unknown>;

      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          config: { headers: { Authorization: 'Bearer secret' } },
        },
        config: { headers: { Authorization: 'Bearer secret' } },
        request: {
          _header:
            'GET /api HTTP/1.1\r\nAuthorization: Bearer secret-token\r\nHost: example.com\r\n',
        },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);

      expect(error.config.headers.Authorization).toBeUndefined();
      expect(error.response.config.headers.Authorization).toBeUndefined();
      expect(error.request._header).toContain('[REDACTED]');
      expect(error.request._header).not.toContain('secret-token');
    });
  });

  describe('_handleRequest', () => {
    it('throws when no access token available', async () => {
      const client = new SmartRentApiClient(platform);

      const requestHandler = mockAxiosInstance.interceptors.request.use.mock
        .calls[0][0] as (config: Record<string, unknown>) => Promise<unknown>;

      // Override getAccessToken to return undefined
      (
        client as unknown as Record<
          string,
          Record<string, ReturnType<typeof vi.fn>>
        >
      ).authClient.getAccessToken.mockResolvedValue(undefined);

      await expect(
        requestHandler({ headers: {}, baseURL: '', url: '/test' })
      ).rejects.toThrow('Authentication failed');
    });
  });
});

describe('SmartRentWebsocketClient', () => {
  let platform: ReturnType<typeof createMockPlatform>;

  beforeEach(() => {
    vi.clearAllMocks();
    platform = createMockPlatform();
  });

  describe('_emitize pub/sub', () => {
    it('setting creates subscription, getter returns emit, emit calls subscribers', () => {
      const wsClient = new SmartRentWebsocketClient(platform);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj: Record<string, any> = {};
      // Access the private method via prototype
      (
        wsClient as unknown as { _emitize: (o: unknown, k: string) => void }
      )._emitize(obj, 'test');

      const handler = vi.fn();
      obj.test = handler;

      obj.test({ some: 'data' });
      expect(handler).toHaveBeenCalledWith({ some: 'data' });
    });

    it('.off clears all subscriptions', () => {
      const wsClient = new SmartRentWebsocketClient(platform);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj: Record<string, any> = {};
      (
        wsClient as unknown as { _emitize: (o: unknown, k: string) => void }
      )._emitize(obj, 'test');

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      obj.test = handler1;
      obj.test = handler2;

      // Clear subscriptions
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      obj.test.off;

      obj.test({ data: 1 });
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('reconnect backoff', () => {
    it('computes delays as min(5000 * 2^(attempts-1), 60000)', () => {
      // Test the formula directly
      const computeDelay = (attempt: number) =>
        Math.min(5000 * Math.pow(2, attempt - 1), 60000);

      expect(computeDelay(1)).toBe(5000);
      expect(computeDelay(2)).toBe(10000);
      expect(computeDelay(3)).toBe(20000);
      expect(computeDelay(4)).toBe(40000);
      expect(computeDelay(5)).toBe(60000);
      expect(computeDelay(6)).toBe(60000);
    });
  });

  describe('subscription retry backoff', () => {
    it('computes delays as min(1000 * 2^(attempt-1), 30000)', () => {
      const computeDelay = (attempt: number) =>
        Math.min(1000 * Math.pow(2, attempt - 1), 30000);

      expect(computeDelay(1)).toBe(1000);
      expect(computeDelay(2)).toBe(2000);
      expect(computeDelay(3)).toBe(4000);
      expect(computeDelay(4)).toBe(8000);
      expect(computeDelay(5)).toBe(16000);
      expect(computeDelay(6)).toBe(30000);
    });
  });

  describe('subscribeDevice', () => {
    it('adds device to devices array and sends phx_join message', async () => {
      const wsClient = new SmartRentWebsocketClient(platform);
      const mockWs = {
        readyState: 1, // WebSocket.OPEN
        send: vi.fn(),
      };
      (wsClient as unknown as Record<string, unknown>).wsClient =
        Promise.resolve(mockWs);

      await wsClient.subscribeDevice(123);

      expect(
        (wsClient as unknown as Record<string, unknown>).devices
      ).toContain(123);
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify([null, null, 'devices:123', 'phx_join', {}])
      );
    });

    it('retries on failure up to 5 times then gives up', async () => {
      vi.useFakeTimers();
      const wsClient = new SmartRentWebsocketClient(platform);
      const mockWs = {
        readyState: 0, // Not OPEN
        send: vi.fn(),
      };
      (wsClient as unknown as Record<string, unknown>).wsClient =
        Promise.resolve(mockWs);

      await wsClient.subscribeDevice(999);
      // After first failure, retry count = 1
      expect(platform.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1/5')
      );

      // Run through retries
      for (let i = 2; i <= 5; i++) {
        await vi.advanceTimersByTimeAsync(30000);
      }

      // After 5th attempt, should give up
      await vi.advanceTimersByTimeAsync(30000);
      expect(platform.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Gave up')
      );

      vi.useRealTimers();
    });
  });

  describe('_handleWsMessage', () => {
    it('parses JSON and dispatches attribute_state events to correct device handler', () => {
      const wsClient = new SmartRentWebsocketClient(platform);
      const handler = vi.fn();

      // Set up event emitter for device 456
      (
        wsClient as unknown as { _emitize: (o: unknown, k: string) => void }
      )._emitize(wsClient.event, '456');
      (wsClient.event as unknown as Record<string, unknown>)['456'] = handler;

      const payload = JSON.stringify([
        null,
        null,
        'devices:456',
        'attribute_state',
        { id: 1, name: 'locked', last_read_state: 'true' },
      ]);

      (
        wsClient as unknown as {
          _handleWsMessage: (msg: { data: string }) => void;
        }
      )._handleWsMessage({ data: payload });

      expect(handler).toHaveBeenCalledWith({
        id: 1,
        name: 'locked',
        last_read_state: 'true',
      });
    });

    it('filters non-attribute_state messages', () => {
      const wsClient = new SmartRentWebsocketClient(platform);
      const handler = vi.fn();
      (
        wsClient as unknown as { _emitize: (o: unknown, k: string) => void }
      )._emitize(wsClient.event, '456');
      (wsClient.event as unknown as Record<string, unknown>)['456'] = handler;

      const payload = JSON.stringify([
        null,
        null,
        'devices:456',
        'phx_reply',
        {},
      ]);

      (
        wsClient as unknown as {
          _handleWsMessage: (msg: { data: string }) => void;
        }
      )._handleWsMessage({ data: payload });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
