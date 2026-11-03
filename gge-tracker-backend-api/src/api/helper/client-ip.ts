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

  public static rateLimitKey(request: express.Request): string {
    const ip = this.resolve(request);
    return isIP(ip) === 6 ? `${this.ipv6Prefix64(ip)}::/64` : ip;
  }

  private static ipv6Prefix64(ip: string): string {
    const address = ip.split('%')[0].toLowerCase();
    const [head, tail] = address.includes('::') ? address.split('::') : [address, undefined];
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
    const groups = [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups];
    return groups
      .slice(0, 4)
      .map((group) => Number.parseInt(group || '0', 16).toString(16))
      .join(':');
  }

  private static firstHeaderValue(request: express.Request, name: string): string | undefined {
    const value = request.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  }

  private static normalize(ip: string): string {
    return ip.replace(/^::ffff:/, '');
  }
}
