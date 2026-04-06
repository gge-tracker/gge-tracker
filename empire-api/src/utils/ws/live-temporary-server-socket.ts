import { BaseSocket, GgeServerType } from './base-socket.js';
import { GgeEmpireSocketImpl } from './gge-socket-impl.js';
import { createClient } from 'redis';

class GgeLiveTemporaryServerSocket extends BaseSocket implements GgeEmpireSocketImpl {
  constructor(url: string, serverHeader: string, username: string, password: string) {
    super(url, serverHeader, GgeServerType.LIVE, false);
    this.url = url;
    this.serverHeader = serverHeader;
    this.username = username;
    this.password = password;
    this.reconnect = false;
    this.connectMethod = this.connect.bind(this);
    this.onMessage = (message: string, parsedMessage: { type: string; payload: any }): void =>
      void this.handleMessage(message, parsedMessage);
  }

  public async connect(): Promise<void> {
    try {
      this.init();
      this.onClose = (code, reason): void => this.handleCloseState(code, reason, false);
      if (!(await this.opened.wait(60_000))) throw new Error('Socket not connected');
      this.log('⌛ [connect] Socket connected, sending login commands...');
      this.sendXmlMessage('sys', 'verChk', '0', "<ver v='166' />");
      await this.waitForXmlResponse('sys', 'apiOK', '0');
      const responseAsync = this.waitForJsonResponse('nfo');
      this.sendXmlMessage(
        'sys',
        'login',
        '0',
        `<login z='${this.serverHeader}'><nick><![CDATA[]]></nick><pword><![CDATA[1065004%fr%0]]></pword></login>`,
      );
      const nfoResponse = await responseAsync;
      this.raiseForStatus(nfoResponse);
      this.sendXmlMessage('sys', 'autoJoin', '-1', '');
      await this.waitForXmlResponse('sys', 'joinOK', '1');
      this.sendXmlMessage('sys', 'roundTrip', '1', '');
      await this.waitForXmlResponse('sys', 'roundTripRes', '1');
      this.sendLoginMessage();
      this.log('⌛ [connect] Sent login command to socket with username:', this.username);
      const lliResponse = await this.waitForJsonResponse('lli');
      if (lliResponse.payload.status === 0) {
        void this.pingAndCheck();
        await this.checkConnection();
      } else {
        if (lliResponse.payload.status === 21) {
          this.log('❌ [connect] Login failed: Invalid credentials. Please check your USERNAME and PASSWORD.');
          return;
        }
        this.log('❌ [connect] Login failed with status:', lliResponse.payload.status);
      }
    } catch (error) {
      this.log('❌ [connect]', error.message);
    }
  }

  private async handleMessage(_message: string, parsedMessage: { type: string; payload: any }): Promise<void> {
    try {
      if (parsedMessage.type === 'json' && parsedMessage.payload.command === 'gbd') {
        this.log('[INFO] [handleMessage] Received gbd message, checking for temporary server data...');
        const content = parsedMessage.payload.data;
        if (content?.sei?.E) {
          const temporaryServer = content.sei.E.find((event: any) => event.EID === 106);
          if (temporaryServer && temporaryServer.TSID) {
            const redisClient = createClient({
              url: 'redis://redis-server:6379',
            });
            await redisClient.connect();
            await redisClient.set('temporaryServerData', temporaryServer.TSID);
            await redisClient.quit();
            this.log('[INFO] [handleMessage] Temporary server TSID saved to Redis:', temporaryServer.TSID);
          }
        } else {
          this.log('[ERR] [handleMessage] gbd message received but no sei.E array found:', parsedMessage.payload.data);
        }
      }
    } catch (error) {
      this.log('[ERR] [handleMessage] Error processing message:', (error as Error)?.message || error);
    }
  }

  private sendLoginMessage(): void {
    super.sendJsonCommand('tlep', {
      TLT: this.password,
    });
  }
}

export { GgeLiveTemporaryServerSocket };
