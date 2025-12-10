import { BaseSocket, GgeServerType } from './base-socket.js';
import { GgeEmpireSocketImpl } from './gge-socket-impl.js';

class GgeEmpireSocket extends BaseSocket implements GgeEmpireSocketImpl {
  constructor(url: string, serverHeader: string, username: string, password: string, autoReconnect = true) {
    super(url, serverHeader, GgeServerType.EP, autoReconnect);
    this.url = url;
    this.serverHeader = serverHeader;
    this.username = username;
    this.password = password;
    this.reconnect = true;
    this.connectMethod = this.connect.bind(this);
  }

  public async connect(): Promise<void> {
    try {
      console.log('🔌 [connect] Connecting to EP socket server:', this.url);
      this.init();
      this.onError = (error): void => this.handleErrorState(error);
      this.onClose = (code, reason): void => this.handleCloseState(code, reason);

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
        this.handleErrorResponse(`Login failed with status: ${lliResponse.payload.status} 🔄 Retrying in 5 minutes...`);
      }
    } catch (error) {
      this.handleErrorResponse(error.message + ' 🔄 Retrying connection in 5 minutes...');
    }
  }

  private sendLoginMessage(): void {
    super.sendJsonCommand('lli', {
      CONM: 175,
      RTM: 24,
      ID: 0,
      PL: 1,
      NOM: this.username,
      PW: this.password,
      LT: null,
      LANG: 'fr',
      DID: '0',
      AID: '1760000000000000000',
      KID: '',
      REF: 'https://empire.goodgamestudios.com',
      GCI: '',
      SID: 9,
      PLFID: 1,
    });
  }
}

export { GgeEmpireSocket };
