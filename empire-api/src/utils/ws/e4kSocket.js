
import { BaseSocket } from './baseSocket.js';
import { Event } from '../event.js';

class E4kSocket {
    constructor(url, serverHeader, username, password) {
        this.url = url;
        this.serverHeader = serverHeader;
        this.username = username;
        this.password = password;
        this.connected = new Event();
        this.reconnect = true;
        this.socket = null;
    }

    async log(message, ...args) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] [${this.serverHeader}] ${message}`, ...args);
    }

    async connect() {
        try {
            this.socket = new BaseSocket(this.url, this.serverHeader);

            this.socket.onError = (error) => {
                this.log("Error occurred in socket", error.message);
                if (["ENOTFOUND", "ETIMEDOUT"].includes(error.code)) {
                    this.disconnect(false);
                } else {
                    this.disconnect(true);
                }
            };

            this.socket.onClose = (code, reason) => {
                this.log("Socket closed with code:", code, "and reason:", reason ? reason.toString() : "No reason provided");
                if (this.reconnect) {
                    this.disconnect(true);
                    setTimeout(() => this.connect(), 10 * 1000);
                } else {
                    this.disconnect(false);
                }
            };

            if (!(await this.socket.opened.wait(60000))) throw new Error("Socket not connected");
            this.log("Socket connected successfully");
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
            await this.ping();
            
            this.socket.sendJsonCommand("core_lga", {NM: this.username, PW: this.password, L: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null"});
            const lgaResponse = await this.socket.waitForJsonResponse("core_lga");
            if (lgaResponse.payload.status === 10005) {
                this.connected.set();
                await this.checkConnection();
            } else if (lgaResponse.payload.status === 10010) {
                this.socket.sendJsonCommand("core_reg", {PN: this.username, PW: this.password, MAIL: `${this.username}@mail.com`, LANG: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null", REF: ""});
                const regResponse = await this.socket.waitForJsonResponse("core_reg");
                if (regResponse.payload.status === 10005) {
                    this.socket.sendJsonCommand("core_lga", {NM: this.username, PW: this.password, L: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null"});
                    const lgaResponse = await this.socket.waitForJsonResponse("core_lga");
                    if (lgaResponse.payload.status === 10005) {
                        this.connected.set();
                        await this.checkConnection();
                    } else {
                        this.disconnect(false);
                    }
                } else {
                    this.disconnect(false);
                }
            } else {
                this.disconnect(false);
            }
        } catch (error) {
            console.log(`### error connecting to socket ${this.serverHeader} ###`);
            console.log(error.message);
            this.disconnect(false);
        }
    }

    disconnect(reconnect=true) {
        this.connected.clear();
        this.reconnect = reconnect;
        if (this.socket) this.socket.close();
        if (!reconnect) this.socket = null;
    }

    async restart() {
        this.disconnect(false);
        this.reconnect = true;
        await this.connect();
    }

    async ping() {
        if (!this.connected.isSet) return;
        this.socket.sendRawCommand("pin", ["<RoundHouseKick>"]);
        setTimeout(() => this.ping(), 60 * 1000);
    }

    async checkConnection() {
        if (!this.connected.isSet) return;
        try {
            this.socket.sendJsonCommand("gpi", {});
            await this.socket.waitForJsonResponse("gpi");
            setTimeout(() => this.checkConnection(), 15 * 60 * 1000);
        } catch (error) {
            this.disconnect(true);
        }
    }
}

export { E4kSocket };