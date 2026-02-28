import { Logger } from 'homebridge';
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { existsSync, promises as fsPromises } from 'fs';
import { resolve as pathResolve } from 'path';
import { SmartRentPlatformConfig } from './config.js';
import {
  BASE_URL,
  SESSION_PATH,
  TFA_PATH,
  WEBSOCKET_TOKEN_PATH,
  AUTH_CLIENT_HEADERS,
} from './request.js';
import { jwtDecode } from 'jwt-decode';
import { authenticator } from 'otplib';

const USER_PREFIX = 'User:';
/** Credentials stored in config.json */
type ConfigCredentials = Pick<
  SmartRentPlatformConfig,
  'email' | 'password' | 'tfaSecret'
>;

/** Login credentials used in SmartRent session request */
type LoginCredentials = {
  email: string;
  password: string;
};

/** Two-factor authentication credentials used in SmartRent session request */
type TfaCredentials = {
  tfa_api_token: string;
  token: string;
};

type Credentials = LoginCredentials | TfaCredentials;

/** OAuth data returned by SmartRent session response */
type OAuthSessionData = {
  access_token: string;
};

/** 2FA data returned by SmartRent two-factor authenticated session response */
type TfaSessionData = {
  tfa_api_token: string;
};

type SessionData = OAuthSessionData | TfaSessionData;

type SessionApiResponse = {
  data: SessionData;
  error?: string;
};

/** Session stored in session.json */
export type Session = {
  userId?: number;
  accessToken?: string;
  expires?: Date;
  websocketExpires?: Date;
  webSocketToken?: string;
};

/**
 * SmartRent Auth client
 */
export class SmartRentAuthClient {
  public isTfaSession = false;
  private session?: Session;
  private _sessionPromise: Promise<Session | undefined> | null = null;
  private _wsTokenPromise: Promise<string | undefined> | null = null;
  private readonly storagePath: string = '~/.homebridge';
  private readonly pluginPath: string = '~/.homebridge/smartrent';
  private readonly sessionPath: string = '~/.homebridge/smartrent/session.json';
  private readonly log: Logger | Console;
  private readonly client: AxiosInstance;

  constructor(storagePath: string, log?: Logger) {
    this.storagePath = storagePath;
    this.pluginPath = pathResolve(this.storagePath, 'smartrent');
    this.sessionPath = pathResolve(this.pluginPath, 'session.json');
    this.log = log ?? console;
    this.client = this._initializeClient();
  }

  private static readonly _isOauthSession = (
    sessionData?: object
  ): sessionData is OAuthSessionData =>
    !!sessionData && 'access_token' in sessionData;

  private static readonly _isTfaSession = (
    sessionData?: object
  ): sessionData is TfaSessionData =>
    !!sessionData && 'tfa_api_token' in sessionData;

  private static _getExpireDate(epochSeconds: number) {
    return new Date(1000 * epochSeconds);
  }

  /**
   * Initialize Axios instance for SmartRent OAuth token requests
   * @returns Axios instance
   */
  private _initializeClient() {
    const authClient = axios.create({
      baseURL: BASE_URL,
      method: 'POST',
      headers: AUTH_CLIENT_HEADERS,
      timeout: 10000,
    });
    authClient.interceptors.response.use(this._handleResponse.bind(this));
    authClient.interceptors.request.use(this._handleRequest.bind(this));
    return authClient;
  }

  /**
   * Log the SmartRent API response
   * @param response Axios response
   * @returns SmartRent response data payload
   */
  private _handleResponse(response: AxiosResponse) {
    this.log.debug(`Auth Response: ${response.status} ${response.statusText}`);
    return response;
  }

  private _handleRequest(config: InternalAxiosRequestConfig) {
    this.log.debug(
      `Auth Request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`
    );
    return config;
  }

  /**
   * Request a new session using either basic or 2FA credentials
   * @param credentials username/password or two-factor authentication credentials
   * @param path API path to request session
   * @returns OAuth 2 session or two-factor authentication data
   */
  private async _requestSession(credentials: Credentials, path: string) {
    const response = await this.client.post<SessionApiResponse>(
      path,
      credentials,
      {
        headers: {
          ...AUTH_CLIENT_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
      }
    );
    return response.data;
  }

  /**
   * Read the session from session.json and store in this.session
   * @returns Session data
   */
  private async _readStoredSession() {
    if (existsSync(this.sessionPath)) {
      try {
        const sessionString = await fsPromises.readFile(
          this.sessionPath,
          'utf8'
        );
        if (!sessionString || sessionString.trim().length === 0) {
          this.log.warn(
            'Session file is empty. Resetting session and starting new authentication.'
          );
          await fsPromises.unlink(this.sessionPath);
          this.session = undefined;
          return;
        }
        this.session = JSON.parse(sessionString) as Session;
      } catch (err) {
        this.log.warn(
          'Session file is invalid or corrupted. Resetting session and starting new authentication.'
        );
        this.log.debug('Session file parse error:', err);
        await fsPromises.unlink(this.sessionPath);
        this.session = undefined;
        return;
      }
    } else if (!existsSync(this.pluginPath)) {
      await fsPromises.mkdir(this.pluginPath);
    }
  }

  /**
   * Format session data from SmartRent API and store to disk
   * @param data SmartRent session data
   * @param refreshed Whether the session was refreshed
   * @returns formatted session data
   */
  private async _storeSession(data: OAuthSessionData, refreshed = false) {
    const jwtData = jwtDecode(data.access_token);
    const exp = jwtData.exp as number;
    const uidString = (jwtData.sub as string).replace(USER_PREFIX, '');
    const uid = parseInt(uidString, 10);
    this.session = {
      ...this.session,
      userId: uid,
      accessToken: data.access_token,
      expires: SmartRentAuthClient._getExpireDate(exp - 60), // refresh 60 seconds before expiration
    };

    this.log.info(`${refreshed ? 'Refreshed' : 'Started'} SmartRent session`);
    const sessionStr = JSON.stringify(this.session, null, 2);
    await fsPromises.writeFile(this.sessionPath, sessionStr);
    this.log.debug('Saved session to', this.sessionPath);
    return this.session;
  }

  private async _storeWebSocketToken(data: string) {
    const jwtData = jwtDecode(data);
    const exp = jwtData.exp as number;
    this.session = {
      ...this.session,
      webSocketToken: data,
      websocketExpires: SmartRentAuthClient._getExpireDate(exp),
    };
    const sessionStr = JSON.stringify(this.session, null, 2);
    await fsPromises.writeFile(this.sessionPath, sessionStr);
    this.log.debug('Saved session to', this.sessionPath);
    return this.session;
  }

  /**
   * Start a new session
   * @param credentials email, password, and 2FA credentials
   * @returns OAuth2 session data
   */
  private async _startSession(credentials: ConfigCredentials) {
    const { email, password, tfaSecret } = credentials;

    // Create a new session using the given credentials
    if (!email && !password) {
      this.log.error('No email or password configured');
      return;
    } else if (!email) {
      this.log.error('No email configured');
      return;
    } else if (!password) {
      this.log.error('No password configured');
      return;
    }

    // Attempt to start a session using the given email and password
    const sessionData = await this._startBasicSession({
      email: email,
      password,
    });

    if (!sessionData) {
      return;
    }

    // If authentication is complete, return the session
    if (SmartRentAuthClient._isOauthSession(sessionData)) {
      this.isTfaSession = false;
      return this._storeSession(sessionData);
    }

    this.log.debug('Session data:', sessionData);
    // If 2FA is enabled, start a 2FA session
    if (SmartRentAuthClient._isTfaSession(sessionData)) {
      this.log.debug('2FA enabled');
      this.isTfaSession = true;
      if (!tfaSecret) {
        this.log.error(
          'Account has 2FA enabled but no 2FA secret is configured'
        );
        return;
      }

      const token = authenticator.generate(tfaSecret);

      return this._startTfaSession({
        tfa_api_token: sessionData.tfa_api_token,
        token: token,
      });
    }

    this.log.error('Failed to create session');
  }

  /**
   * Get a new session using the given username & password
   * @param credentials username & password credentials
   * @returns OAuth2 session data
   */
  private async _startBasicSession(credentials: LoginCredentials) {
    return this._requestSession(credentials, SESSION_PATH).catch(error => {
      this._handleResponseError(
        error,
        'Invalid email or password',
        'create session'
      );
    });
  }

  /**
   * Get a new session using the given 2FA credentials
   * @param credentials two-factor authentication credentials
   * @returns OAuth2 session data
   */
  private async _startTfaSession(credentials: TfaCredentials) {
    try {
      const sessionData = await this._requestSession(credentials, TFA_PATH);
      if (SmartRentAuthClient._isOauthSession(sessionData)) {
        return this._storeSession(sessionData);
      }
      this.log.error('Failed to create 2FA session');
    } catch (error) {
      this._handleResponseError(
        error,
        'Invalid 2FA code',
        'create 2FA session'
      );
    }
  }

  // /**
  //  * Refresh a session
  //  * @returns OAuth2 session data
  //  */
  // private async _refreshSession() {
  //   const refreshToken = this.session?.refreshToken;
  //   if (!refreshToken) {
  //     this.log.error('No refresh token');
  //     return;
  //   }
  //   try {
  //     const response = await this.client.post<{ data: OAuthSessionData }>(
  //       '/tokens',
  //       undefined,
  //       {
  //         headers: {
  //           ...AUTH_CLIENT_HEADERS,
  //           'Authorization-X-Refresh': refreshToken,
  //         },
  //       }
  //     );
  //     const sessionData = response.data.data;
  //     return this._storeSession(sessionData, true);
  //   } catch (error) {
  //     this._handleResponseError(
  //       error,
  //       'Refresh token expired',
  //       'refresh session'
  //     );
  //   }
  // }

  private _handleResponseError(
    error: unknown,
    authMsg: string,
    action: string
  ) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      if (
        axiosError.response.status === 401 ||
        axiosError.response.status === 403
      ) {
        this.log.error(authMsg);
      } else {
        this.log.error(`Failed to ${action}`);
      }
    } else {
      this.log.error(`Unknown error while attempting to ${action}`, error);
    }
  }

  private async _getWebsocketToken(session: Session) {
    try {
      const response = await this.client.post<{ token: string }>(
        WEBSOCKET_TOKEN_PATH,
        undefined,
        {
          headers: {
            ...AUTH_CLIENT_HEADERS,
            Authorization: `Bearer ${session.accessToken}`,
          },
        }
      );
      const token = response.data?.token;
      if (!token) {
        this.log.warn('WebSocket token endpoint returned 200 but no token');
        return;
      }
      await this._storeWebSocketToken(token);
      return token;
    } catch (error) {
      this.log.warn('Failed to fetch WebSocket token:', error);
      return;
    }
  }

  /**
   * Get the current session if valid, a new session, or a refreshed session.
   * Uses a promise-based mutex so concurrent callers share a single session creation.
   * @returns OAuth2 session data
   */
  private async _getSession(
    credentials: ConfigCredentials
  ): Promise<Session | undefined> {
    if (this._sessionPromise) {
      return this._sessionPromise;
    }

    this._sessionPromise = this._getSessionInternal(credentials).finally(() => {
      this._sessionPromise = null;
    });

    return this._sessionPromise;
  }

  private async _getSessionInternal(credentials: ConfigCredentials) {
    await this._readStoredSession();

    // Return the stored session if it's valid
    if (
      this.session?.expires &&
      new Date(this.session.expires) > new Date(Date.now())
    ) {
      return this.session;
    }

    // Create a new session using the given credentials
    return this._startSession(credentials);
  }

  /**
   * Get the stored access token or a refreshed token if it's expired
   * @returns OAuth2 access token
   */
  public async getAccessToken(credentials: ConfigCredentials) {
    const session = await this._getSession(credentials);
    if (session && 'accessToken' in session) {
      return session.accessToken;
    }
    this.log.error('Failed to authenticate with SmartRent');
  }

  /**
   * Get the stored WebSocket token or fetch a new one if expired.
   * Uses a promise-based mutex so concurrent callers share a single token fetch.
   * @returns WebSocket token
   */
  public async getWebSocketToken(
    credentials: ConfigCredentials
  ): Promise<string | undefined> {
    if (this._wsTokenPromise) {
      return this._wsTokenPromise;
    }

    this._wsTokenPromise = this._getWebSocketTokenInternal(credentials).finally(
      () => {
        this._wsTokenPromise = null;
      }
    );

    return this._wsTokenPromise;
  }

  private async _getWebSocketTokenInternal(credentials: ConfigCredentials) {
    const session = await this._getSession(credentials);
    if (!session) {
      this.log.error('Failed to get WebSocket Token from SmartRent');
      return;
    }
    if (
      session?.websocketExpires &&
      new Date(session.websocketExpires) > new Date(Date.now())
    ) {
      return session.webSocketToken;
    }
    const token = await this._getWebsocketToken(session);
    if (token) {
      return token;
    }
    this.log.error('Failed to authenticate with SmartRent');
  }

  /**
   * Clear cached access token so the next request triggers a fresh login.
   * Persists to disk so retry flows don't re-read the stale token.
   */
  public async clearAccessToken() {
    if (this.session) {
      this.session.accessToken = undefined;
      this.session.expires = undefined;
      const sessionStr = JSON.stringify(this.session, null, 2);
      await fsPromises.writeFile(this.sessionPath, sessionStr);
    }
  }

  /**
   * Clear cached WebSocket token so the next connection fetches a fresh one.
   * Persists to disk so reconnect flows don't re-read the stale token.
   */
  public async clearWebSocketToken() {
    if (this.session) {
      this.session.webSocketToken = undefined;
      this.session.websocketExpires = undefined;
      const sessionStr = JSON.stringify(this.session, null, 2);
      await fsPromises.writeFile(this.sessionPath, sessionStr);
    }
  }
}
