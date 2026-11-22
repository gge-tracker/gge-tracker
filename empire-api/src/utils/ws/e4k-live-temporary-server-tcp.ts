import { GgeEmpire4KingdomsTcp } from './empire4kingdoms-tcp.js';
import { findTemporaryServerId, saveTemporaryServerId } from './temporary-server-id.js';

class GgeE4kLiveTemporaryServerTcp extends GgeEmpire4KingdomsTcp {
  private static readonly LOGIN_ANSWER = 'gbd';

  protected storeTemporaryServerId = saveTemporaryServerId;

  constructor(url: string, serverHeader: string, username: string, password: string) {
    super(url, serverHeader, username, password, false);
    this.watchedCommands.add('gbd');
    this.onMessage = (_message: string, parsedMessage: { type: string; payload: any }): void =>
      void this.handleMessage(parsedMessage);
  }

  protected async login(): Promise<void> {
    const loginAnswer = this.waitForJsonResponse(GgeE4kLiveTemporaryServerTcp.LOGIN_ANSWER);
    this.sendJsonCommand('tlep', { TLT: this.password });
    this.log('⌛ [connect] Sent the event login token');
    const response = await loginAnswer;
    if (response.payload.status === 0) {
      void this.pingAndCheck();
      return;
    }
    this.log('❌ [connect] Event login refused with status:', response.payload.status);
  }

  private async handleMessage(parsedMessage: { type: string; payload: any }): Promise<void> {
    try {
      if (parsedMessage.type !== 'json' || parsedMessage.payload.command !== 'gbd') return;
      const temporaryServerId = findTemporaryServerId(parsedMessage.payload.data);
      if (temporaryServerId === null) return;
      await this.storeTemporaryServerId('e4k', temporaryServerId);
      this.log('[INFO] [handleMessage] E4K temporary server TSID saved to Redis:', temporaryServerId);
    } catch (error) {
      this.log('[ERR] [handleMessage] Error processing message:', (error as Error)?.message || error);
    }
  }
}

export { GgeE4kLiveTemporaryServerTcp };
