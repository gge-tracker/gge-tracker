import express from 'express';
import { isIP } from 'node:net';

export abstract class ClientIp {
  public static resolve(request: express.Request): string {
    const cloudflareIp = this.firstHeaderValue(request, 'cf-connecting-ip');
    if (cloudflareIp && isIP(cloudflareIp)) return this.normalize(cloudflareIp);

    const forwardedFor = this.firstHeaderValue(request, 'x-forwarded-for');
    const ip = forwardedFor?.split(',')[0].trim() || request.ip || 'unknown';
    return this.normalize(ip);
  }

  private static firstHeaderValue(request: express.Request, name: string): string | undefined {
    const value = request.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  }

  private static normalize(ip: string): string {
    return ip.replace(/^::ffff:/, '');
  }
}
