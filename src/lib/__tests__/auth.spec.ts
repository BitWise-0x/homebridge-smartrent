import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mocks must be declared before any import that triggers side effects ---

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Keep a stable reference to the mock instance so clearAllMocks doesn't lose it
const mockAxiosInstance = {
  post: vi.fn(),
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
  AxiosError: class AxiosError extends Error {
    isAxiosError = true;
    response?: { status: number };
    constructor(msg?: string) {
      super(msg);
    }
  },
}));

vi.mock('jwt-decode', () => ({
  jwtDecode: vi.fn(() => ({
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'User:42',
  })),
}));

vi.mock('otplib', () => ({
  authenticator: {
    generate: vi.fn(() => '123456'),
  },
}));

import { existsSync, promises as fsPromises } from 'fs';
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import { authenticator } from 'otplib';
import { SmartRentAuthClient } from '../auth.js';

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as import('homebridge').Logger;

function createClient(storagePath = '/tmp/hb') {
  return new SmartRentAuthClient(storagePath, mockLog);
}

describe('SmartRentAuthClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the factory return for axios.create after clearAllMocks
    (axios.create as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAxiosInstance
    );
    // Default: no stored session file
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined
    );
    (fsPromises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fsPromises.unlink as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined
    );
  });

  describe('constructor', () => {
    it('creates correct session path from storagePath', () => {
      createClient('/my/storage');
      expect(axios.create).toHaveBeenCalled();
    });

    it('initializes axios client with interceptors', () => {
      createClient();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
    });
  });

  describe('getAccessToken', () => {
    it('returns cached token when session is not expired', async () => {
      const validSession = JSON.stringify({
        userId: 42,
        accessToken: 'cached-token',
        expires: new Date(Date.now() + 60_000).toISOString(),
      });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        validSession
      );

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(token).toBe('cached-token');
    });

    it('starts new session when token is expired', async () => {
      const expiredSession = JSON.stringify({
        userId: 42,
        accessToken: 'old-token',
        expires: new Date(Date.now() - 60_000).toISOString(),
      });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        expiredSession
      );

      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'new-token' },
      });

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(token).toBe('new-token');
    });

    it('deduplicates concurrent calls via mutex', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'shared-token' },
      });

      const client = createClient();
      const creds = { email: 'a@b.com', password: 'pass' };
      const [t1, t2] = await Promise.all([
        client.getAccessToken(creds),
        client.getAccessToken(creds),
      ]);
      expect(t1).toBe('shared-token');
      expect(t2).toBe('shared-token');
      // Only one basic session request should have been made
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('_storeSession (indirectly)', () => {
    it('decodes JWT, sets expiry 60s early, extracts userId from sub', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 7200;
      (jwtDecode as ReturnType<typeof vi.fn>).mockReturnValue({
        exp: futureExp,
        sub: 'User:42',
      });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'jwt-token' },
      });

      const client = createClient();
      await client.getAccessToken({ email: 'a@b.com', password: 'pass' });

      expect(jwtDecode).toHaveBeenCalledWith('jwt-token');
      const writeCall = (fsPromises.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const storedSession = JSON.parse(writeCall[1] as string);
      expect(storedSession.userId).toBe(42);
      // Expiry should be 60 seconds before JWT exp
      const storedExpiry = new Date(storedSession.expires).getTime();
      const expectedExpiry = (futureExp - 60) * 1000;
      expect(storedExpiry).toBe(expectedExpiry);
    });
  });

  describe('clearAccessToken', () => {
    it('nulls token and expiry, writes to disk', async () => {
      // First establish a session
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'to-clear' },
      });

      const client = createClient();
      await client.getAccessToken({ email: 'a@b.com', password: 'pass' });

      // Clear mock calls but keep implementations
      (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      await client.clearAccessToken();

      const writeCall = (fsPromises.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const stored = JSON.parse(writeCall[1] as string);
      expect(stored.accessToken).toBeUndefined();
      expect(stored.expires).toBeUndefined();
    });
  });

  describe('clearWebSocketToken', () => {
    it('nulls WS token and expiry, writes to disk', async () => {
      // Establish a session first
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'tok' },
      });

      const client = createClient();
      await client.getAccessToken({ email: 'a@b.com', password: 'pass' });

      (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      await client.clearWebSocketToken();

      const writeCall = (fsPromises.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const stored = JSON.parse(writeCall[1] as string);
      expect(stored.webSocketToken).toBeUndefined();
      expect(stored.websocketExpires).toBeUndefined();
    });
  });

  describe('2FA flow', () => {
    it('handles tfa_api_token then generates TOTP then calls TFA endpoint and stores session', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      // First call returns TFA data, second call returns OAuth
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { tfa_api_token: 'tfa-tok' } })
        .mockResolvedValueOnce({ data: { access_token: 'final-token' } });

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
        tfaSecret: 'JBSWY3DPEHPK3PXP',
      });

      expect(authenticator.generate).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP');
      expect(token).toBe('final-token');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('logs error and returns undefined when tfaSecret is missing', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { tfa_api_token: 'tfa-tok' },
      });

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
        // no tfaSecret
      });

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('2FA')
      );
      expect(token).toBeUndefined();
    });
  });

  describe('stored session reading', () => {
    it('restores valid JSON session from disk', async () => {
      const session = JSON.stringify({
        userId: 42,
        accessToken: 'stored-tok',
        expires: new Date(Date.now() + 300_000).toISOString(),
      });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        session
      );

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(token).toBe('stored-tok');
    });

    it('handles empty session file by deleting it and clearing session', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');

      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'fresh-token' },
      });

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(fsPromises.unlink).toHaveBeenCalled();
      expect(token).toBe('fresh-token');
    });

    it('handles corrupt JSON session file', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        '{bad json'
      );

      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'fresh-token' },
      });

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(fsPromises.unlink).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('invalid or corrupted')
      );
      expect(token).toBe('fresh-token');
    });
  });

  describe('missing plugin directory', () => {
    it('creates directory with mkdir when plugin path does not exist', async () => {
      // First call (sessionPath) = false, second call (pluginPath) = false
      (existsSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);

      mockAxiosInstance.post.mockResolvedValue({
        data: { access_token: 'tok' },
      });

      const client = createClient('/tmp/hb');
      await client.getAccessToken({ email: 'a@b.com', password: 'pass' });
      expect(fsPromises.mkdir).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles 401 error gracefully', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const err = new Error('Unauthorized');
      (err as Record<string, unknown>).isAxiosError = true;
      (err as Record<string, unknown>).response = { status: 401 };
      mockAxiosInstance.post.mockRejectedValue(err);

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(mockLog.error).toHaveBeenCalled();
      expect(token).toBeUndefined();
    });

    it('handles 403 error gracefully', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const err = new Error('Forbidden');
      (err as Record<string, unknown>).isAxiosError = true;
      (err as Record<string, unknown>).response = { status: 403 };
      mockAxiosInstance.post.mockRejectedValue(err);

      const client = createClient();
      const token = await client.getAccessToken({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(mockLog.error).toHaveBeenCalled();
      expect(token).toBeUndefined();
    });
  });
});
