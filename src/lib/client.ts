import axios, {
  InternalAxiosRequestConfig,
  AxiosResponse,
  AxiosInstance,
  AxiosRequestHeaders,
} from 'axios';
import {
  API_URL,
  API_CLIENT_HEADERS,
  WS_API_URL,
  WS_VERSION,
} from './request.js';
import { SmartRentAuthClient } from './auth.js';
import { SmartRentPlatform } from '../platform.js';
import WebSocket from 'ws';
import { Logger } from 'homebridge';

export type WSDeviceList = `devices:${string}`;
export type WSEvent = {
  id: number;
  name:
    | 'leak'
    | 'fan_mode'
    | 'current_temp'
    | 'current_humidity'
    | 'heating_setpoint'
    | 'cooling_setpoint'
    | 'mode'
    | 'locked'
    | 'on'
    | 'notifications'
    | 'motion_binary'
    | 'operating_state'
    | 'level';
  remote_id: string;
  type: string;
  last_read_state: string;
  last_read_state_changed_at: string;
};
export type WSPayload = [null, null, WSDeviceList, string, WSEvent];

export class SmartRentApiClient {
  protected readonly authClient: SmartRentAuthClient;
  private readonly apiClient: AxiosInstance;
  protected readonly log: Logger | Console;

  constructor(readonly platform: SmartRentPlatform) {
    this.authClient = new SmartRentAuthClient(
      platform.api.user.storagePath(),
      platform.log
    );
    this.log = platform.log ?? console;
    this.apiClient = this._initializeApiClient();
  }

  /**
   * Initialize Axios instance for SmartRent API requests
   * @returns Axios instance
   */
  private _initializeApiClient() {
    const apiClient = axios.create({
      baseURL: API_URL,
      headers: API_CLIENT_HEADERS,
      timeout: 10000,
      transitional: { clarifyTimeoutError: true },
    });
    apiClient.interceptors.request.use(this._handleRequest.bind(this));
    apiClient.interceptors.response.use(
      this._handleResponse.bind(this),
      this._handleResponseError.bind(this)
    );
    return apiClient;
  }

  /**
   * Get the SmartRent API access token
   * @returns Oauth access token
   */
  public async getAccessToken() {
    return this.authClient.getAccessToken({
      email: this.platform.config.email,
      password: this.platform.config.password,
      tfaSecret: this.platform.config.tfaSecret,
    });
  }

  /**
   * Get the SmartRent API access token
   * @returns Oauth access token
   */
  public async getWebSocketToken() {
    return this.authClient.getWebSocketToken({
      email: this.platform.config.email,
      password: this.platform.config.password,
      tfaSecret: this.platform.config.tfaSecret,
    });
  }

  /**
   * Attach the access token to the SmartRent API request and log the request
   * @param config Axios request config
   * @returns Axios request config
   */
  private async _handleRequest(config: InternalAxiosRequestConfig) {
    const token = await this.getAccessToken();
    if (!token) {
      this.log.error('No access token available. Aborting API request.');
      throw new Error('Authentication failed: No access token');
    }
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    } as AxiosRequestHeaders;
    this.log.debug(
      `API Request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`
    );
    return config;
  }

  /**
   * Log the SmartRent API response
   * @param response Axios response
   * @returns SmartRent response data payload
   */
  private _handleResponse(response: AxiosResponse) {
    const dataSize =
      response.headers['content-length'] ??
      JSON.stringify(response.data).length;
    this.log.debug(
      `API Response: ${response.status} ${response.statusText} (${dataSize} bytes)`
    );
    return response;
  }

  /**
   * On 401, clear cached token, re-authenticate, and retry once.
   * Sanitize Authorization headers from errors to prevent token leakage in logs.
   */
  private async _handleResponseError(error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        await this.authClient.clearAccessToken();
        const config = error.config;
        if (
          config &&
          !(config as unknown as Record<string, unknown>).__retried
        ) {
          (config as unknown as Record<string, unknown>).__retried = true;
          try {
            const token = await this.getAccessToken();
            if (token) {
              config.headers.Authorization = `Bearer ${token}`;
              this.log.debug(
                'Token expired, re-authenticated and retrying request'
              );
              return this.apiClient.request(config);
            }
          } catch {
            // Re-auth failed, fall through to reject
          }
        }
      }
      // Strip auth headers to prevent token leakage in logs
      SmartRentApiClient._sanitizeAxiosError(error);
    }
    return Promise.reject(error);
  }

  /**
   * Remove Authorization headers from an AxiosError to prevent token leakage.
   *
   * A timed-out request is a follow-redirects Writable, which keeps its own copy
   * of the resolved options and nests the raw header string on _currentRequest.
   * Node prints the whole object graph on an unhandled rejection, so every copy
   * has to be scrubbed, not just the one on error.config.
   */
  private static readonly MAX_SCRUB_DEPTH = 8;
  private static readonly REDACTED = '[REDACTED]';
  // Any bearer token, wherever it appears: header strings, urls, query
  // strings. Matching on the value rather than the key name catches the
  // places a token turns up under a name other than Authorization.
  private static readonly BEARER_PATTERN =
    /Bearer(?:%20|\s)+[A-Za-z0-9._~+/=-]+/gi;

  /** Redact tokens inside a string, or return it unchanged. */
  private static _redactString(value: string): string {
    return value.replace(
      SmartRentApiClient.BEARER_PATTERN,
      `Bearer ${SmartRentApiClient.REDACTED}`
    );
  }

  /**
   * Best-effort write. Frozen and sealed objects throw on both delete and
   * assignment in strict mode, and this runs outside any try/catch in the
   * response interceptor — a throw here would replace the real network error
   * with a confusing TypeError and break the retry classifier.
   */
  private static _tryWrite(
    record: Record<PropertyKey, unknown>,
    key: PropertyKey,
    value: unknown
  ): void {
    try {
      record[key] = value;
    } catch {
      // Non-writable target; the value stays but nothing else breaks.
    }
  }

  private static _sanitizeAxiosError(error: import('axios').AxiosError) {
    // Records the depth an object was last walked at. Re-walking is allowed
    // when the object is reached again from a shallower root, otherwise a
    // deep first visit would permanently cut off children that a shallower
    // path could still have scrubbed.
    const seenAtDepth = new Map<object, number>();

    const scrub = (value: unknown, depth: number): void => {
      if (
        depth > SmartRentApiClient.MAX_SCRUB_DEPTH ||
        value === null ||
        typeof value !== 'object'
      ) {
        return;
      }
      const previous = seenAtDepth.get(value);
      if (previous !== undefined && previous <= depth) {
        return;
      }
      seenAtDepth.set(value, depth);

      // Buffers are index-keyed byte arrays: walking them costs one entry per
      // byte and yields nothing, but their contents can hold raw request
      // bytes, so redact them wholesale instead.
      if (Buffer.isBuffer(value)) {
        const text = value.toString('latin1');
        const redacted = SmartRentApiClient._redactString(text);
        if (redacted !== text) {
          value.write(redacted.padEnd(value.length, ' '), 0, 'latin1');
        }
        return;
      }

      if (value instanceof Map) {
        for (const [key, entry] of value) {
          if (typeof entry === 'string') {
            const redacted = SmartRentApiClient._redactString(entry);
            if (redacted !== entry) {
              try {
                value.set(key, redacted);
              } catch {
                // Frozen Map-likes; leave it.
              }
            }
          } else {
            scrub(entry, depth + 1);
          }
        }
        return;
      }

      if (value instanceof Set) {
        // Set members cannot be edited in place, so a offending string is
        // swapped for its redacted form.
        const replacements: [unknown, string][] = [];
        for (const entry of value) {
          if (typeof entry === 'string') {
            const redacted = SmartRentApiClient._redactString(entry);
            if (redacted !== entry) {
              replacements.push([entry, redacted]);
            }
          } else {
            scrub(entry, depth + 1);
          }
        }
        for (const [original, redacted] of replacements) {
          try {
            value.delete(original);
            value.add(redacted);
          } catch {
            // Frozen Set-likes; leave it.
          }
        }
        return;
      }

      const record = value as Record<PropertyKey, unknown>;
      // Symbol keys matter here: node stores the outgoing header map under
      // Symbol(kOutHeaders), which Object.keys cannot see.
      const keys: PropertyKey[] = [
        ...Object.keys(record),
        ...Object.getOwnPropertySymbols(record),
      ];
      for (const key of keys) {
        let child: unknown;
        try {
          child = record[key];
        } catch {
          continue; // getters on the socket can throw
        }
        if (
          typeof key === 'string' &&
          key.toLowerCase() === 'authorization' &&
          typeof child === 'string'
        ) {
          SmartRentApiClient._tryWrite(
            record,
            key,
            SmartRentApiClient.REDACTED
          );
        } else if (typeof child === 'string') {
          const redacted = SmartRentApiClient._redactString(child);
          if (redacted !== child) {
            SmartRentApiClient._tryWrite(record, key, redacted);
          }
        } else if (Array.isArray(child)) {
          // kOutHeaders entries are [originalName, value] pairs
          for (let i = 0; i < child.length; i++) {
            if (typeof child[i] === 'string') {
              const redacted = SmartRentApiClient._redactString(
                child[i] as string
              );
              if (redacted !== child[i]) {
                SmartRentApiClient._tryWrite(
                  child as unknown as Record<PropertyKey, unknown>,
                  i,
                  redacted
                );
              }
            }
          }
          scrub(child, depth + 1);
        } else {
          scrub(child, depth + 1);
        }
      }
    };

    scrub(error.config, 0);
    scrub(error.response?.config, 0);
    scrub(error.request, 0);
  }

  // API request methods

  public async get<T, D = unknown>(
    path: string,
    config?: InternalAxiosRequestConfig<D>
  ) {
    const response = await this.apiClient.get<T>(path, config);
    return response.data;
  }

  public async post<T, D = unknown>(
    path: string,
    data?: D,
    config?: InternalAxiosRequestConfig<D>
  ) {
    const response = await this.apiClient.post<T>(path, data, config);
    return response.data;
  }

  public async patch<T, D = unknown>(
    path: string,
    data?: D,
    config?: InternalAxiosRequestConfig<D>
  ) {
    const response = await this.apiClient.patch<T>(path, data, config);
    return response.data;
  }
}

export class SmartRentWebsocketClient extends SmartRentApiClient {
  public wsClient: Promise<WebSocket | undefined>;
  public event: object;
  private readonly devices: number[];
  private _reconnecting = false;
  private _reconnectAttempts = 0;
  private _subscribeRetries: Record<number, number> = {};
  private _heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(readonly platform: SmartRentPlatform) {
    super(platform);
    this.wsClient = Promise.resolve(undefined);
    this.event = {};
    this.devices = [];
  }

  /**
   * Connect the WebSocket client. Must be called after authentication is established.
   */
  public async connect(): Promise<void> {
    this.wsClient = this._initializeWsClient();
    await this.wsClient;
  }

  private _emitize(obj: object, eventName: string) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    let _subscriptions = new Set<Function>();
    Object.defineProperty(obj, eventName, {
      set(func) {
        _subscriptions.add(func);
      },
      get() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emit = (...args: any[]) => {
          _subscriptions.forEach(f => f(...args));
        };

        Object.defineProperty(emit, 'off', {
          set(func) {
            _subscriptions.delete(func);
          },
          get() {
            _subscriptions = new Set();
          },
        });

        return emit;
      },
    });
  }

  /**
   * Initialize WebSocket client for SmartRent API
   * @returns WebSocket client
   */
  private async _initializeWsClient(): Promise<WebSocket | undefined> {
    this.log.debug('WebSocket connection opening');
    const token = await this.getWebSocketToken();
    if (!token || token === 'undefined') {
      this.log.warn(
        'Authentication failed: No WebSocket token! SmartRent WebSocket features disabled.'
      );
      return undefined;
    }
    const wsClient = new WebSocket(
      WS_API_URL +
        '?' +
        new URLSearchParams({
          token: String(token),
          vsn: WS_VERSION,
        }).toString()
    );

    return new Promise<WebSocket>((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        wsClient.close();
        reject(new Error('WebSocket connection timed out'));
      }, 30000);

      wsClient.onopen = () => {
        clearTimeout(connectionTimeout);
        this._handleWsOpen(wsClient);
        resolve(wsClient);
      };
      wsClient.onmessage = this._handleWsMessage.bind(this);
      wsClient.onerror = (error: WebSocket.ErrorEvent) => {
        clearTimeout(connectionTimeout);
        this._handleWsError(error);
        reject(new Error(`WebSocket connection failed: ${error.message}`));
      };
      wsClient.onclose = this._handleWsClose.bind(this);
    });
  }

  private _handleWsOpen(ws: WebSocket) {
    this.log.debug('WebSocket connection opened');
    this._reconnectAttempts = 0;
    this._subscribeRetries = {};
    this._startHeartbeat(ws);
    this.devices.forEach(device => this.subscribeDevice(device));
  }

  private _startHeartbeat(ws: WebSocket) {
    this._stopHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify([null, null, 'phoenix', 'heartbeat', {}]));
        this.log.debug('WebSocket heartbeat sent');
      }
    }, 30000);
  }

  private _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  private _handleWsMessage(message: WebSocket.MessageEvent) {
    try {
      this.log.debug(`WebSocket message received: Data: ${message.data}`);
      const data: WSPayload = JSON.parse(String(message.data));
      if (data[3]?.includes('attribute_state')) {
        const device = data[2]?.split(':')[1];
        if (device && typeof this.event[device] === 'function') {
          this.log.debug(String(data[4]));
          this.event[device](data[4]);
        }
      }
    } catch (error) {
      this.log.error('Failed to process WebSocket message:', error);
    }
  }

  private _scheduleReconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    this._reconnectAttempts++;
    const delay = Math.min(
      5000 * Math.pow(2, this._reconnectAttempts - 1),
      60000
    );
    this.log.warn(
      `WebSocket reconnecting in ${delay / 1000}s (attempt ${this._reconnectAttempts})`
    );
    setTimeout(() => {
      this._reconnecting = false;
      this.wsClient = this._initializeWsClient().catch(err => {
        this.log.error('WebSocket reconnection failed:', err);
        this._scheduleReconnect();
        return undefined;
      });
    }, delay);
  }

  private _handleWsError(error: WebSocket.ErrorEvent) {
    this.log.error(`WebSocket error: ${error.message}`);
    this._stopHeartbeat();
    this.wsClient.then(client => client?.close()).catch(() => {});
    if (error.message?.includes('403')) {
      this.authClient.clearWebSocketToken().catch(() => {});
    }
    this._scheduleReconnect();
  }

  private _handleWsClose(event: WebSocket.CloseEvent) {
    this.log.debug(
      `WebSocket connection closed: Code: ${event.code}, Reason: ${event.reason}`
    );
    this._stopHeartbeat();
    this._scheduleReconnect();
  }

  /**
   * Adds device to websocket client subsciption list and announces events to device handlers
   * @param deviceId Device ID
   */
  public async subscribeDevice(deviceId: number) {
    this.log.debug(`Subscribing to device: ${deviceId}`);
    if (!this.devices.includes(deviceId)) {
      this.devices.push(deviceId);
      this._emitize(this.event, `${deviceId}`);
    }
    try {
      const wsClient = await this.wsClient;
      if (!wsClient) {
        this.log.warn(
          'WebSocket client not initialized. Device subscription skipped.'
        );
        return;
      }
      if (wsClient.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not ready');
      }
      wsClient.send(
        JSON.stringify(<WSPayload>[
          null,
          null,
          `devices:${deviceId}`,
          'phx_join',
          {},
        ])
      );
      this._subscribeRetries[deviceId] = 0;
      this.log.debug(`Subscribed to device: ${deviceId}`);
    } catch (err) {
      const attempt = (this._subscribeRetries[deviceId] ?? 0) + 1;
      this._subscribeRetries[deviceId] = attempt;
      const MAX_RETRIES = 5;
      if (attempt > MAX_RETRIES) {
        this.log.warn(
          `Gave up subscribing to device ${deviceId} after ${MAX_RETRIES} attempts.`
        );
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      this.log.warn(String(err));
      this.log.warn(
        `Failed to subscribe device ${deviceId}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`
      );
      setTimeout(() => this.subscribeDevice(deviceId), delay);
    }
  }
}
