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
