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

export interface ScheduledMessage {
  channelId: string;
  embeds: { timestamp?: string }[];
}

const POST_STEP_MS = 5 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;

const pending = new Set<Promise<void>>();

export function nextPostingMark(now: Date): Date {
  return new Date(Math.ceil(now.getTime() / POST_STEP_MS) * POST_STEP_MS);
}

export function scheduleDiscordPost(apiUrl: string, message: ScheduledMessage, label: string): Promise<void> {
  const mark = nextPostingMark(new Date());
  for (const embed of message.embeds) embed.timestamp = mark.toISOString();
  const post = waitUntil(mark)
    .then(() =>
      axios.post(apiUrl, message, { headers: { 'Content-Type': 'application/json' }, timeout: SEND_TIMEOUT_MS }),
    )
    .then(() => Utils.logMessage(` [info] ${label} posted on Discord at ${mark.toISOString()}`))
    .catch((error: unknown) => Utils.logWarning(`Unable to post ${label} on Discord`, error))
    .finally(() => pending.delete(post));
  pending.add(post);
  return post;
}

export async function flushDiscordPosts(): Promise<void> {
  await Promise.all([...pending]);
}

function waitUntil(mark: Date): Promise<void> {
  const delay = Math.max(mark.getTime() - Date.now(), 0);
  return new Promise((resolve) => setTimeout(resolve, delay));
}
