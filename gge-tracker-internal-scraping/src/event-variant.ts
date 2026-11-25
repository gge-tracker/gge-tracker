//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
export type CustomEventName = 'Outer Realms' | 'Beyond the Horizon';

export const PREVIOUS_RUN_COMMAND = 'gpr';

const PREVIOUS_RUN_KEYS: Record<CustomEventName, 'TS' | 'ABG'> = {
  'Outer Realms': 'TS',
  'Beyond the Horizon': 'ABG',
};

export function readPreviousRunSettingId(gprContent: unknown, eventName: CustomEventName): number | null {
  const run = (gprContent as Record<string, { TSID?: unknown } | undefined> | null)?.[PREVIOUS_RUN_KEYS[eventName]];
  const settingId = Number(run?.TSID);
  return Number.isInteger(settingId) && settingId > 0 ? settingId : null;
}
