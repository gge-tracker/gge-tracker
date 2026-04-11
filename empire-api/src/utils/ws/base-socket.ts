import WebSocket from 'ws';
import { AsyncEvent } from '../event.js';
import { HeadersUtilities } from '../nested-headers.js';
import { Log } from './log.js';

export enum GgeServerType {
  E4K = 'E4K',
  EP = 'EP',
  LIVE = 'LIVE',
}

export enum SocketState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  KILLED = 'KILLED',
}

class BaseSocket extends Log {
  private static readonly XML_REGEX = /<msg t='(.*?)'><body action='(.*?)' r='(.*?)'>(.*?)<\/body><\/msg>/;
  public opened: AsyncEvent;
  public closed: AsyncEvent;
  public connected: AsyncEvent;
  public connectMethod: () => Promise<void>;
  public socketState: SocketState;
  public pingTimeout: NodeJS.Timeout;
  public checkConnectionTimeout: NodeJS.Timeout;
  public restartTimeout: NodeJS.Timeout;
  public sendGblTimeout: NodeJS.Timeout;
  protected url: string;
  protected serverHeader: string;
  protected messages: any[];
  protected ws: WebSocket;
  protected username: string;
  protected password: string;
  protected reconnect: boolean;
  protected hasGbl: boolean;
  protected nbReconnects: number;
  protected onSend: (data: string) => void;
  protected onOpen: (ws: WebSocket) => void;
  protected onMessage: (message: string, parsedMessage: { type: string; payload: any }) => Promise<void> | void;
  protected onError: (error: unknown) => void;
  protected onClose: (code: number, reason: Buffer) => void;

  constructor(url: string, serverHeader: string, serverType: GgeServerType, autoReconnect = true) {
    super(serverHeader, serverType);
    this.url = url;
    this.serverHeader = serverHeader;
    this.onSend = null;
    this.onOpen = null;
    this.onMessage = null;
    this.onError = null;
    this.onClose = null;
    this.opened = new AsyncEvent();
    this.connected = new AsyncEvent();
    this.closed = new AsyncEvent();
    this.messages = [];
    this.nbReconnects = 0;
    this.hasGbl = process.env.API_TYPE?.toLowerCase() === 'realtime';
    this.reconnect = autoReconnect;
  }

  public async pingAndCheck(): Promise<void> {
    if (this.socketState === SocketState.KILLED) {
      this.warn('[pingAndCheck] Socket is killed. No ping or connection check will be performed.');
      return;
    }
    this.success('[pingAndCheck] Login successful, checking connection...');
    this.connected.set();
    this.socketState = SocketState.CONNECTED;
    // Send initial ping after 5 seconds to allow the connection to stabilize.
    // Subsequent pings will be sent every 60 seconds in the ping() method.
    setTimeout(() => this.ping(), 5000);
    if (this.hasGbl) {
      clearTimeout(this.sendGblTimeout);
      this.sendGblTimeout = setTimeout(() => {
        this.sendJsonCommand('gbl', {});
        this.log('[pingAndCheck] Sent gbl command to socket');
      }, 1000);
    }
    this.nbReconnects = 0;
    if (this.reconnect) {
      await this.checkConnection();
    }
  }

  public async restart(instant = false): Promise<void> {
    this.log('[restart] Restarting socket connection...');
    this.connected.clear();
    this.closed.clear();
    this.opened.clear();
    if (this.socketState === SocketState.KILLED) {
      this.warn('[restart] Socket is killed. Restart will not be performed.');
      return;
    }
    this.socketState = SocketState.DISCONNECTED;
    const nbReconnects = this.nbReconnects++;
    const randomDelay = Math.floor(Math.random() * 30);
    let defaultDelay = 120;
    if (!instant && nbReconnects > 0) {
      if (nbReconnects < 5) {
        const incrementalDelay = [0, 3, 5, 20, 30][Math.min(nbReconnects, 4)];
        this.log(`[restart] Incremental delay: ${incrementalDelay} minutes`);
        defaultDelay += incrementalDelay * 60;
      } else {
        this.log(`[restart] Max incremental delay reached. Keeping at 60 minutes.`);
        defaultDelay = 60 * 60;
      }
    }
    const finalDelay = instant ? 0 : defaultDelay + randomDelay;
    this.log(`[restart] Restarting socket connection in ${finalDelay} seconds... (Total retries: ${nbReconnects})`);
    this.disconnect();
    clearTimeout(this.restartTimeout);
    await this.sleep(3000);
    clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(async () => {
      await this.connectMethod();
    }, finalDelay * 1000);
  }

  public async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public disconnect(): void {
    this.log(this.url, '[disconnect] Disconnecting from socket. Cleaning up resources...');
    this.connected.clear();
    this.closed.clear();
    this.opened.clear();
    this.socketState = SocketState.DISCONNECTED;
    this.clearTimeouts();
    this.ws.close();
  }

  public async checkConnection(): Promise<void> {
    if (this.socketState === SocketState.KILLED) {
      this.warn('[checkConnection] Socket is killed. No connection check will be performed.');
      this.connected.clear();
      this.closed.set();
      this.clearTimeouts();
      return;
    } else if (!this.reconnect) {
      this.warn('[checkConnection] Reconnect is disabled. No connection check will be performed.');
      return;
    }
    if (!this.connected.isSet || this.socketState !== SocketState.CONNECTED) {
      this.warn(
        '[checkConnection] Socket is not connected (connected:',
        this.connected.isSet,
        'socketState:',
        this.socketState,
        '). Attempting to restart the connection.',
      );
      this.connected.clear();
      this.closed.set();
      this.clearTimeouts();
      this.restartTimeout = setTimeout(
        () => {
          if (this.reconnect && this.socketState !== SocketState.KILLED) {
            void this.restart(true);
          } else {
            this.warn('[checkConnection] Reconnect is disabled or socket is killed. No restart will be performed.');
          }
        },
        10 * 60 * 1000,
      );
      return;
    }
    try {
      this.sendJsonCommand('gpi', {});
      await this.waitForJsonResponse('gpi');
      clearTimeout(this.checkConnectionTimeout);
      this.checkConnectionTimeout = setTimeout(() => this.checkConnection(), 15 * 60 * 1000);
      this.muted('[checkConnection] Connection check successful. Next check in 15 minutes.');
    } catch (error) {
      this.error(`[checkConnection] Connection check failed, restarting socket in 10 seconds...`);
      this.error('Error details:', error instanceof Error ? error.message : error);
      clearTimeout(this.restartTimeout);
      this.restartTimeout = setTimeout(() => {
        if (this.reconnect && this.socketState !== SocketState.KILLED) {
          this.warn('[checkConnection] Connection check failed. Restarting socket now.');
          void this.restart();
        } else {
          this.warn('[checkConnection] Reconnect is disabled or socket is killed. No restart will be performed.');
        }
      }, 10 * 1000);
    }
  }

  public sendRawCommand(command: string, data: string[]): void {
    this._sendCommandMessage(['xt', this.serverHeader, command, '1', ...data]);
  }

  public sendJsonCommand(command: string, data: any): void {
    this._sendCommandMessage(['xt', this.serverHeader, command, '1', JSON.stringify(data)]);
  }

  public sendXmlMessage(t: string, action: string, r: string, data: string): void {
    this.send(`<msg t='${t}'><body action='${action}' r='${r}'>${data}</body></msg>`);
  }

  public handleErrorState(error: unknown): void {
    this.error('[onError] Error occurred in socket', error instanceof Error ? error.message : error);
    switch (this.socketState) {
      case SocketState.KILLED: {
        this.warn('[onError] Error occurred but socket is killed. No action will be taken.');
        break;
      }
      default: {
        this.warn('[onError] Unknown socket state. Attempting to restart the connection as a precaution.');
        void this.restart();
      }
    }
  }

  public handleCloseState(code: number, reason: Buffer): void {
    if (this.socketState === SocketState.KILLED) {
      this.warn('[onClose] Socket is killed. No action will be taken on close event.');
      return;
    }
    this.disconnect();
    this.log(
      '⚡ [onClose] Socket closed with code:',
      code,
      'and reason:',
      reason ? reason.toString() : 'No reason provided',
    );
  }

  public init(): void {
    this.opened.clear();
    this.closed.clear();
    this.connected.clear();
    this.socketState = SocketState.CONNECTING;
    this.ws = new WebSocket(this.url);
    this.nbReconnects = 0;
    this.ws.on('open', () => this._onOpen());
    this.ws.on('message', (message) => this._onMessage(message));
    this.ws.on('error', (error) => this._onError(error));
    this.ws.on('close', (code, reason) => this._onClose(code, reason));
  }

  public kill(): void {
    this.log('💀 [kill] Killing socket connection. This action is irreversible.');
    this.reconnect = false;
    this.socketState = SocketState.KILLED;
    this.disconnect();
  }

  public handleErrorResponse(message: string, timeout: number = 5 * 60 * 1000): void {
    this.error('[connect]', message);
    clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(() => {
      void this.restart();
    }, timeout);
  }

  public waitForJsonResponse(command: string, data: any = false, timeout = 5000): Promise<any> {
    return this._waitForResponse('json', { command, data }, timeout);
  }

  public waitForXmlResponse(t: string, action: string, r: string, timeout = 5000): Promise<any> {
    return this._waitForResponse('xml', { t, action, r }, timeout);
  }

  public raiseForStatus(response: { type: string; payload: { status: number } }, expectedStatus = 0): void {
    if (response.type === 'json' && response.payload.status !== expectedStatus) {
      throw new Error(`Unexpected status: ${response.payload.status}`);
    }
  }

  public _onMessage(message: any, needToStringOption = true): void {
    if (needToStringOption) {
      message = message.toString();
    }
    const response = this.parseResponse(message);
    this._processResponse(response);
    if (this.onMessage) void this.onMessage(message, response);
  }

  protected send(data: string): void {
    if (this.onSend) this.onSend(data);
    this.ws.send(data);
  }

  private ping(): void {
    if (this.socketState === SocketState.KILLED) {
      this.warn('[ping] Socket is killed. No ping will be sent.');
      return;
    }
    if (
      !this.connected.isSet ||
      this.socketState !== SocketState.CONNECTED ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      this.warn(
        '[ping] Cannot send ping, socket is not connected :',
        'connected:',
        this.connected.isSet,
        'socketState:',
        this.socketState,
        'wsReadyState:',
        this.ws ? this.ws.readyState : 'ws not initialized',
      );
      return;
    }
    this.sendRawCommand('pin', ['<RoundHouseKick>']);
    clearTimeout(this.pingTimeout);
    this.pingTimeout = setTimeout(() => this.ping(), 60 * 1000);
  }

  private _onOpen(): void {
    this.opened.set();
    if (this.onOpen) this.onOpen(this.ws);
  }

  private clearTimeouts(): void {
    clearTimeout(this.pingTimeout);
    clearTimeout(this.restartTimeout);
    clearTimeout(this.sendGblTimeout);
    clearTimeout(this.checkConnectionTimeout);
  }

  private _onError(error: unknown): void {
    this.opened.clear();
    this.connected.clear();
    this.closed.set();
    this.socketState = SocketState.DISCONNECTED;
    if (this.onError) this.onError(error);
  }

  private _onClose(code: number, reason: Buffer<ArrayBufferLike>): void {
    this.opened.clear();
    this.connected.clear();
    this.closed.set();
    this.socketState = SocketState.DISCONNECTED;
    if (this.onClose) this.onClose(code, reason);
  }

  private _sendCommandMessage(data: string[]): void {
    this.send(`%${data.join('%')}%`);
  }

  private async _waitForResponse(
    type: 'json' | 'xml',
    conditions: { [key: string]: any },
    timeout = 5000,
  ): Promise<any> {
    const event = new AsyncEvent();
    const message = { type, conditions, response: null, event };
    this.messages.push(message);
    const result = await event.wait(timeout);
    this.messages = this.messages.filter((message_) => message_ !== message);
    if (!result) throw new Error('Timeout waiting for response');
    return message.response;
  }

  private parseResponse(response: string): { type: string; payload: any } {
    if (response.startsWith('<')) {
      const parsed = BaseSocket.XML_REGEX.exec(response);
      return {
        type: 'xml',
        payload: {
          t: parsed[1],
          action: parsed[2],
          r: parsed[3],
          data: parsed[4],
        },
      };
    } else {
      const parsed = response.split('%').filter(Boolean);
      const payload = {
        command: parsed[1],
        status: +parsed[3],
        data: parsed.length > 4 ? parsed.slice(4).join('%') : null,
      };
      if (payload.data && payload.data.startsWith('{')) {
        payload.data = JSON.parse(payload.data);
      }
      return { type: 'json', payload };
    }
  }

  private _processResponse(response: { type: string; payload: any }): void {
    for (const message of this.messages) {
      if (
        (response.type === 'json' &&
          message.type === 'json' &&
          message.conditions.command === response.payload.command &&
          (message.conditions.data === false ||
            (message.conditions.data === true && response.payload.data !== null) ||
            message.conditions.data === response.payload.data ||
            (typeof response.payload.data === 'object' &&
              typeof message.conditions.data === 'object' &&
              HeadersUtilities.compareNestedHeaders(message.conditions.data, response.payload.data)))) ||
        (response.type === 'xml' &&
          message.type === 'xml' &&
          message.conditions.t === response.payload.t &&
          message.conditions.action === response.payload.action &&
          message.conditions.r === response.payload.r)
      ) {
        message.response = response;
        message.event.set();
        break;
      }
    }
  }
}

export { BaseSocket };
