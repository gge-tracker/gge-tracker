//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
export const ANNOUNCED_TSID_KEY = 'outerRealmsAnnouncedTsid';

export type OuterRealmsAnnouncement = 'none' | 'record' | 'announce';

export function outerRealmsAnnouncement(current: string | null, announced: string | null): OuterRealmsAnnouncement {
  if (!current || current === announced) return 'none';
  return announced === null ? 'record' : 'announce';
}
