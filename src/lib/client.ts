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
  private readonly authClient: SmartRentAuthClient;
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
    });
    apiClient.interceptors.request.use(this._handleRequest.bind(this));
    apiClient.interceptors.response.use(this._handleResponse.bind(this));
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
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      this.log.error('No access token available. Aborting API request.');
      throw new Error('Authentication failed: No access token');
    }
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${accessToken}`,
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
  private _subscribeRetries: Record<number, number> = {};
  private _heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(readonly platform: SmartRentPlatform) {
    super(platform);
    this.wsClient = this._initializeWsClient();
    this.event = {};
    this.devices = [];
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
    setTimeout(() => {
      this._reconnecting = false;
      this.wsClient = this._initializeWsClient().catch(err => {
        this.log.error('WebSocket reconnection failed:', err);
        this._scheduleReconnect();
        return undefined;
      });
    }, 5000);
  }

  private _handleWsError(error: WebSocket.ErrorEvent) {
    this.log.error(`WebSocket error: ${error.message}`);
    this._stopHeartbeat();
    this.wsClient.then(client => client?.close());
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
