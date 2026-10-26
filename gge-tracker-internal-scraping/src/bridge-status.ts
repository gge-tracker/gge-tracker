//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import axios from 'axios';
import Utils from './utils';

export type BridgeStatus = Record<string, boolean>;

export async function readBridgeStatus(bridgeUrl: string): Promise<BridgeStatus | null> {
  try {
    const { data } = await axios.get(new URL('/status', bridgeUrl).toString(), {
      timeout: 5000,
    });
    return data && typeof data === 'object' ? (data as BridgeStatus) : null;
  } catch {
    return null;
  }
}

export function isSocketDown(status: BridgeStatus | null, zone: string): boolean {
  return status?.[zone] === false;
}

export function zoneOf(baseApiUrl: string): string {
  return new URL(baseApiUrl).pathname.split('/').find(Boolean) ?? '';
}

export function bridgeOf(baseApiUrl: string): string {
  return new URL(baseApiUrl).hostname.endsWith('-realtime') ? 'realtime' : 'standard';
}

export function reportDisconnectedAccount(server: string, baseApiUrl: string, job: string): void {
  const zone = zoneOf(baseApiUrl);
  const bridge = bridgeOf(baseApiUrl);
  Utils.logRecord(
    'warn',
    { event: 'account_disconnected', server, zone, bridge, job },
    `${server} skipped by ${job}: its game account is disconnected on the ${bridge} bridge`,
  );
}
