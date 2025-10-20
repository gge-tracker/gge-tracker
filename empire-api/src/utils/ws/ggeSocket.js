
import { BaseSocket } from './baseSocket.js';
import { Event } from '../event.js';

class GgeSocket {
  nbReconnects = 0;

  constructor(url, serverHeader, username, password) {
    this.url = url;
    this.serverHeader = serverHeader;
    this.username = username;
    this.password = password;
    this.connected = new Event();
    this.reconnect = true;
    this.socket = null;
    this.hasGbl = process.env.HAS_GBL?.toLowerCase() === 'true';
  }

  async log(message, ...args) {
    const day = new Date().toLocaleDateString();
    const time = new Date().toLocaleTimeString();
    console.log(`[${day} ${time}] [EP][${this.serverHeader}] ${message}`, ...args);
  }

  async connect() {
    try {
      this.socket = new BaseSocket(this.url, this.serverHeader);
      this.socket.onError = (error) => {
        this.log("❌ [onError] Error occurred in socket", error);
        this.restart();
      };

      this.socket.onClose = (code, reason) => {
        this.log("⚡ [onClose] Socket closed with code:", code, "and reason:", reason ? reason.toString() : "No reason provided");
        this.disconnect(true);
      };

      if (!(await this.socket.opened.wait(60000))) throw new Error("Socket not connected");
      this.log("⌛ [connect] Socket connected, sending login commands...");
      this.socket.sendXmlMessage("sys", "verChk", "0", "<ver v='166' />")
      await this.socket.waitForXmlResponse("sys", "apiOK", "0")
      const responseAsync = this.socket.waitForJsonResponse("nfo")
      this.socket.sendXmlMessage("sys", "login", "0", `<login z='${this.serverHeader}'><nick><![CDATA[]]></nick><pword><![CDATA[1065004%fr%0]]></pword></login>`)
      const nfoResponse = await responseAsync;
      this.socket.raiseForStatus(nfoResponse)
      this.socket.sendXmlMessage("sys", "autoJoin", "-1", "")
      await this.socket.waitForXmlResponse("sys", "joinOK", "1")
      this.socket.sendXmlMessage("sys", "roundTrip", "1", "")
      await this.socket.waitForXmlResponse("sys", "roundTripRes", "1")

      this.socket.sendJsonCommand("lli", { CONM: 175, RTM: 24, ID: 0, PL: 1, NOM: this.username, PW: this.password, LT: null, LANG: "fr", DID: "0", AID: "1674256959939529708", KID: "", REF: "https://empire.goodgamestudios.com", GCI: "", SID: 9, PLFID: 1 /*, RCT: recaptcha.token */ });
      this.log("⌛ [connect] Sent login command to socket with username:", this.username);
      const lliResponse = await this.socket.waitForJsonResponse("lli");
      if (lliResponse.payload.status === 0) {
        this.connected.set();
        await this.ping();
        this.log("✅ [connect] Login successful, checking connection...");
        if (this.hasGbl) {
          setTimeout(() => {
            this.socket.sendJsonCommand("gbl", {});
            this.log("⌛ [connect] Sent gbl command to socket");
          }, 1000);
        }
        this.nbReconnects = 0;
        await this.checkConnection();
      } else {
        if (lliResponse.payload.status === 21) {
          this.log("❌ [connect] Login failed: Invalid credentials. Please check your USERNAME and PASSWORD.");
          return;
        }
        this.log("❌ [connect] Login failed with status:", lliResponse.payload.status, "retrying in 5 minutes...");
        setTimeout(() => {
          this.restart();
        }, 5 * 60 * 1000);
      }
    } catch (error) {
      this.log("❌ [connect] Error connecting to socket:", error.message);
      this.log("🔄 [connect] Retrying connection in 5 minutes...");
      setTimeout(() => {
        this.restart();
      }, 5 * 60 * 1000);
    }
  }

  disconnect(reconnect = true) {
    this.log("🧹 [disconnect] Disconnecting from socket. Cleaning up resources...");
    this.connected.clear();
    this.reconnect = reconnect;
    if (this.socket) this.socket.close();
    this.socket = null;
  }

  async restart() {
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
      await this.connect();
    }, finalDelay * 1000);
  }

  async ping() {
    if (!this.connected.isSet) return;
    this.socket.sendRawCommand("pin", ["<RoundHouseKick>"]);
    setTimeout(() => this.ping(), 60 * 1000);
  }

  async checkConnection() {
    if (!this.connected.isSet) {
      this.log("⚠️ [checkConnection] Socket is not connected, skipping connection check.");
      setTimeout(() => {
        if (!this.connected.isSet) {
          this.restart();
        }
      }, 10 * 60 * 1000);
      return;
    }
    try {
      this.socket.sendJsonCommand("gpi", {});
      await this.socket.waitForJsonResponse("gpi");
      setTimeout(() => this.checkConnection(), 15 * 60 * 1000);
    } catch (error) {
      this.log("❌ [checkConnection] Connection check failed, restarting socket in 10 seconds...");
      this.log("Error details:", error);
      setTimeout(() => {
        if (this.connected.isSet) {
          this.restart();
        } else {
          this.log("⚠️ [checkConnection] Socket is not connected, not restarting.");
        }
      }, 10 * 1000);
    }
  }
}

export { GgeSocket };
