import { GgeServerType } from './base-socket.js';

export class Log {
  private _serverHeader: string;
  private _serverType: GgeServerType;

  private gray = this.color(90);
  private bold = this.color(1);
  private green = this.color(32);
  private yellow = this.color(33);
  private blue = this.color(34);

  constructor(serverHeader: string, serverType: GgeServerType) {
    this._serverHeader = serverHeader;
    this._serverType = serverType;
  }

  public log(message: string, ...arguments_: any[]): void {
    const now = new Date();
    const timestamp = this.formatDate(now);

    const typeColor = this.getColorForServerType(this._serverType);
    const headerColor = this.getColorForServerHeader(this._serverHeader);

    const output =
      `${this.gray(`[${timestamp}]`)} ` +
      `${this.bold(typeColor(`[${this._serverType}]`))}` +
      `${this.bold(headerColor(`[${this._serverHeader}]`))} ` +
      `${message}`;

    console.log(output, ...arguments_);
  }

  private color(code: number): (text: string) => string {
    return (text: string): string => `\u001B[${code}m${text}\u001B[0m`;
  }

  private getColorForServerType(serverType: GgeServerType): (text: string) => string {
    switch (serverType) {
      case GgeServerType.EP: {
        return this.blue;
      }
      case GgeServerType.E4K: {
        return this.green;
      }
      case GgeServerType.LIVE: {
        return this.yellow;
      }
      default: {
        return this.gray;
      }
    }
  }

  private getColorForServerHeader(serverHeader: string): (text: string) => string {
    const hash = this.hashString(serverHeader);
    const colors = [
      33, 39, 45, 51, 75, 81, 87, 112, 118, 154, 178, 184, 220, 202, 208, 214, 196, 197, 203, 165, 171, 177, 129, 135,
      141,
    ];
    const code = colors[hash % colors.length];
    return this.color(code);
  }

  private formatDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  }

  private hashString(string_: string): number {
    let hash = 0;
    for (let index = 0; index < string_.length; index++) {
      hash = string_.codePointAt(index) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  }
}
