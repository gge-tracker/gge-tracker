import { BaseSocket, GgeServerType } from './base-socket.js';
import { GgeEmpireSocketImpl } from './gge-socket-impl.js';

const E4kEnumLoginStatus = {
  SUCCESS: 10_005,
  PLAYER_NOT_FOUND: 10_010,
};

class GgeEmpire4KingdomsSocket extends BaseSocket implements GgeEmpireSocketImpl {
  constructor(url: string, serverHeader: string, username: string, password: string) {
    super(url, serverHeader, GgeServerType.E4K);
    this.url = url;
    this.serverHeader = serverHeader;
    this.username = username;
    this.password = password;
    this.reconnect = true;
    this.connectMethod = this.connect.bind(this);
  }

  public async connect(): Promise<void> {
    try {
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

export { GgeEmpire4KingdomsSocket };
