import { BaseSocket, GgeServerType } from './base-socket.js';
import { GgeEmpireSocketImpl } from './gge-socket-impl.js';
import * as net from 'node:net';

const E4kEnumLoginStatus = {
  SUCCESS: 10_005,
  PLAYER_NOT_FOUND: 10_010,
};

class GgeEmpire4KingdomsTcp extends BaseSocket implements GgeEmpireSocketImpl {
  private socket: net.Socket;
  constructor(url: string, serverHeader: string, username: string, password: string, autoReconnect = true) {
    super(url, serverHeader, GgeServerType.E4K, autoReconnect);
    this.url = url;
    this.serverHeader = serverHeader;
    this.username = username;
    this.password = password;
    this.reconnect = autoReconnect;
    this.connectMethod = this.connect.bind(this);
  }

  public async getHostAndPort(): Promise<{ host: string; port: number }> {
    let [hostPart, portPart] = this.url.replace('tcp://', '').split(':');
    if (!portPart) {
      portPart = '443';
    }
    return { host: hostPart, port: Number(portPart) };
  }

  public async connect(): Promise<void> {
    try {
      console.log('🔌 [connect] Connecting to Empire4Kingdoms TCP socket server:', this.url);
      const { host, port } = await this.getHostAndPort();
      this.socket = net.createConnection(port, host, () => {
        this.log('✅ [connect] TCP socket connected to', this.url);
        this.opened.set();
      });

      this.socket.on('error', (error): void => this.handleErrorState(error));
      this.socket.on('close', (hadError): void => this.handleCloseState(hadError ? 1006 : 1000, Buffer.from('')));
      this.socket.on('data', (data: Buffer): void => this.handleTcpData(data));

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
      const lgaResponse = await this.waitForJsonResponse('core_lga');
      if (lgaResponse.payload.status === E4kEnumLoginStatus.SUCCESS) {
        void this.pingAndCheck();
      } else if (lgaResponse.payload.status === E4kEnumLoginStatus.PLAYER_NOT_FOUND) {
        this.log('❌ [connect] Login failed: Register a new account...');
        this.sendRegisterMessage();
        const regResponse = await this.waitForJsonResponse('core_reg');
        if (regResponse.payload.status === E4kEnumLoginStatus.SUCCESS) {
          this.log('✅ [connect] Registration successful, proceeding to login...');
          this.sendLoginMessage();
          const lgaLoginResponse = await this.waitForJsonResponse('core_lga');
          if (lgaLoginResponse.payload.status === E4kEnumLoginStatus.SUCCESS) {
            void this.pingAndCheck();
          } else {
            const message = `Login after registration failed with status: ${lgaLoginResponse.payload.status} 🔄 Retrying in 5 minutes...`;
            this.handleErrorResponse(message);
          }
        } else {
          const message = `Registration failed with status: ${regResponse.payload.status} 🔄 Retrying in 5 minutes...`;
          this.handleErrorResponse(message);
        }
      } else {
        const message = `Login failed with status: ${lgaResponse.payload.status} 🔄 Retrying in 5 minutes...`;
        this.handleErrorResponse(message);
      }
    } catch (error) {
      this.handleErrorResponse(error.message + ' 🔄 Retrying connection in 5 minutes...');
    }
  }

  protected send(data: string): void {
    this.socket.write(data + '\u0000');
  }

  private handleTcpData(data: Buffer): void {
    let parsedData = data.toString();
    let nullIndex: number;
    while ((nullIndex = parsedData.indexOf('\u0000')) !== -1) {
      const message = parsedData.slice(0, Math.max(0, nullIndex));
      parsedData = parsedData.slice(Math.max(0, nullIndex + 1));
      void this._onMessage(message, false);
    }
  }

  private sendLoginMessage(): void {
    super.sendJsonCommand('core_lga', {
      NM: this.username,
      PW: this.password,
      L: 'fr',
      AID: '1760000000000000000',
      DID: '5',
      PLFID: '3',
      ADID: 'null',
      AFUID: 'ggetracker',
      IDFV: 'null',
    });
  }

  private sendRegisterMessage(): void {
    super.sendJsonCommand('core_reg', {
      PN: this.username,
      PW: this.password,
      MAIL: `${this.username}-${Math.floor(Math.random() * 99_999)}@mail.com`,
      LANG: 'fr',
      AID: '1760000000000000000',
      DID: '5',
      PLFID: '3',
      ADID: 'null',
      AFUID: 'appsFlyerUID',
      IDFV: 'null',
      REF: '',
    });
  }
}

export { GgeEmpire4KingdomsTcp };
