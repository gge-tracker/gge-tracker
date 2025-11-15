import WebSocket from 'ws';
import { AsyncEvent } from '../event.js';
import { HeadersUtilities } from '../nested-headers.js';
import { Log } from './log.js';

export enum GgeServerType {
  E4K = 'E4K',
  EP = 'EP',
}

class BaseSocket extends Log {
  public opened: AsyncEvent;
  public closed: AsyncEvent;
  public connected: AsyncEvent;
  public connectMethod: () => Promise<void>;
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
  protected onMessage: (message: string) => void;
  protected onError: (error: unknown) => void;
  protected onClose: (code: number, reason: Buffer) => void;

  constructor(url: string, serverHeader: string, serverType: GgeServerType) {
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
    this.hasGbl = process.env.HAS_GBL?.toLowerCase() === 'true';
  }

  public async pingAndCheck(): Promise<void> {
    this.log('✅ [connect] Login successful, checking connection...');
    this.connected.set();
    await this.ping();
    if (this.hasGbl) {
      setTimeout(() => {
        this.sendJsonCommand('gbl', {});
        this.log('⌛ [connect] Sent gbl command to socket');
      }, 1000);
    }
    this.nbReconnects = 0;
    await this.checkConnection();
  }

  public async restart(): Promise<void> {
    const nbReconnects = this.nbReconnects++;
    const randomDelay = Math.floor(Math.random() * 30);
    let defaultDelay = 120;
    if (nbReconnects > 0) {
      if (nbReconnects < 5) {
        const incrementalDelay = [0, 3, 5, 20, 30][Math.min(nbReconnects, 4)];
        this.log(`🔄 [restart] Incremental delay: ${incrementalDelay} minutes`);
        defaultDelay += incrementalDelay * 60;
      } else {
        this.log(`🔄 [restart] Max incremental delay reached. Keeping at 60 minutes.`);
        defaultDelay = 60 * 60;
      }
    }
    const finalDelay = defaultDelay + randomDelay;
    this.log(`🔄 [restart] Restarting socket connection in ${finalDelay} seconds... (Total retries: ${nbReconnects})`);
    this.disconnect(false);
    this.reconnect = true;
    setTimeout(async () => {
      await this.connectMethod();
    }, finalDelay * 1000);
  }

  public disconnect(reconnect = true): void {
    this.log('🧹 [disconnect] Disconnecting from socket. Cleaning up resources...');
    this.connected.clear();
    this.reconnect = reconnect;
    this.close();
  }

  public async checkConnection(): Promise<void> {
    if (!this.connected.isSet) {
      this.log('⚠️ [checkConnection] Socket is not connected, skipping connection check.');
      setTimeout(
        () => {
          if (!this.connected.isSet) {
            void this.restart();
          }
        },
        10 * 60 * 1000,
      );
      return;
    }
    try {
      this.sendJsonCommand('gpi', {});
      await this.waitForJsonResponse('gpi');
      setTimeout(() => this.checkConnection(), 15 * 60 * 1000);
    } catch (error) {
      this.log('❌ [checkConnection] Connection check failed, restarting socket in 10 seconds...');
      this.log('Error details:', error);
      setTimeout(() => {
        if (this.connected.isSet) {
          void this.restart();
        } else {
          this.log('⚠️ [checkConnection] Socket is not connected, not restarting.');
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
    this.log('❌ [onError] Error occurred in socket', error);
    void this.restart();
  }

  public handleCloseState(code: number, reason: Buffer): void {
    this.log(
      '⚡ [onClose] Socket closed with code:',
      code,
      'and reason:',
      reason ? reason.toString() : 'No reason provided',
    );
    this.disconnect(true);
  }

  public init(): void {
    this.ws = new WebSocket(this.url);
    this.ws.on('open', () => this._onOpen());
    this.ws.on('message', (message) => this._onMessage(message));
    this.ws.on('error', (error) => this._onError(error));
    this.ws.on('close', (code, reason) => this._onClose(code, reason));
    this.nbReconnects = 0;
  }

  public close(): void {
    this.ws.close();
  }

  public handleErrorResponse(message: string, timeout: number = 5 * 60 * 1000): void {
    this.log('❌ [connect]', message);
    setTimeout(() => {
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

  private async ping(): Promise<void> {
    if (!this.connected.isSet) return;
    this.sendRawCommand('pin', ['<RoundHouseKick>']);
    setTimeout(() => this.ping(), 60 * 1000);
  }

  private _onOpen(): void {
    this.opened.set();
    if (this.onOpen) this.onOpen(this.ws);
  }

  private async _onMessage(message: any): Promise<void> {
    message = message.toString();
    const response = await this.parseResponse(message);
    this._processResponse(response);
    if (this.onMessage) this.onMessage(message);
  }

  private _onError(error: unknown): void {
    if (this.onError) this.onError(error);
  }

  private _onClose(code: number, reason: Buffer<ArrayBufferLike>): void {
    this.opened.clear();
    this.closed.set();
    if (this.onClose) this.onClose(code, reason);
  }

  private send(data: string): void {
    if (this.onSend) this.onSend(data);
    this.ws.send(data);
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

  private async parseResponse(response: string): Promise<any> {
    if (response.startsWith('<')) {
      const parsed = /<msg t='(.*?)'><body action='(.*?)' r='(.*?)'>(.*?)<\/body><\/msg>/.exec(response);
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
