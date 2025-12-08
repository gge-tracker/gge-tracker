import { GgeServerType } from './base-socket.js';

export class Log {
  private _serverHeader: string;
  private _serverType: GgeServerType;

  constructor(serverHeader: string, serverType: GgeServerType) {
    this._serverHeader = serverHeader;
    this._serverType = serverType;
  }

  public log(message: string, ...arguments_: any[]): void {
    const day = new Date().toLocaleDateString();
    const time = new Date().toLocaleTimeString();
    console.log(`[${day} ${time}] [${this._serverType}][${this._serverHeader}] ${message}`, ...arguments_);
  }
}
