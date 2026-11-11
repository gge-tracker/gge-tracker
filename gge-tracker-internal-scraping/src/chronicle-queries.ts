//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { ChronicleWindow, EventKey } from './chronicle-model';
import { LootReset, lootWeekEnd, lootWeekStart } from './loot-reset';

export const EVENT_TABLES: Record<EventKey, string> = {
  nomad: 'player_event_nomad_history',
  samurai: 'player_event_samurai_history',
  bloodcrow: 'player_event_bloodcrow_history',
  berimond: 'player_event_berimond_kingdom_history',
  war_realms: 'player_event_war_realms_history',
};

// Same gap as the event pages
export const EVENT_RUN_GAP_SECONDS = 86_400;

function seconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function inWindow(window: ChronicleWindow): string {
  return `created_at >= toDateTime(${seconds(window.fromMs)}) AND created_at < toDateTime(${seconds(window.untilMs)})`;
}

export function firstReadingQuery(database: string): string {
  return `SELECT toUnixTimestamp(min(created_at)) AS first FROM \`${database}\`.player_might_history`;
}

// One day is one median
function dailyMight(database: string, window: ChronicleWindow, timezone: string): string {
  return `
    SELECT player_id, toDate(created_at, '${timezone}') AS day, count() AS readings,
      toInt64(quantile(0.5)(point)) AS day_value
    FROM \`${database}\`.player_might_history
    WHERE ${inWindow(window)}
    GROUP BY player_id, day`;
}

export function mightQuery(database: string, window: ChronicleWindow, timezone: string): string {
  return `
    SELECT player_id, sum(readings) AS hours, toString(min(day)) AS first_day, toString(argMax(day, day_value)) AS peak_day,
      argMin(day_value, day) AS might_start, argMax(day_value, day) AS might_end,
      max(day_value) AS might_peak, min(day_value) AS might_low,
      if(max(jump) > 0, toString(argMax(day, jump)), '') AS best_day, greatest(max(jump), 0) AS best_day_gain
    FROM (
      SELECT *, if(day - lagInFrame(day, 1, day) OVER w = 1, day_value - lagInFrame(day_value, 1, day_value) OVER w, 0) AS jump
      FROM (${dailyMight(database, window, timezone)})
      WINDOW w AS (PARTITION BY player_id ORDER BY day ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
    )
    GROUP BY player_id`;
}

export function monthlyMightQuery(database: string, window: ChronicleWindow, timezone: string): string {
  return `
    SELECT player_id, toYYYYMM(day) AS month, argMax(day_value, day) AS might
    FROM (${dailyMight(database, window, timezone)})
    GROUP BY player_id, month`;
}

export function serverDaysQuery(database: string, window: ChronicleWindow, timezone: string): string {
  return `
    SELECT DISTINCT toString(toDate(created_at, '${timezone}')) AS day
    FROM \`${database}\`.player_might_history
    WHERE ${inWindow(window)}
    ORDER BY day`;
}

export function dailyRanksQuery(
  database: string,
  window: ChronicleWindow,
  timezone: string,
  maxPosition: number,
): string {
  return `
    SELECT player_id, arrayMap(t -> (toString(t.1), t.2), groupArray((day, position))) AS top_days
    FROM (
      SELECT player_id, day, rank() OVER (PARTITION BY day ORDER BY day_value DESC) AS position
      FROM (${dailyMight(database, window, timezone)})
    )
    WHERE position <= ${maxPosition}
    GROUP BY player_id`;
}

export function lootWeekStarts(window: ChronicleWindow, reset: LootReset): number[] {
  const starts: number[] = [];
  for (let start = lootWeekStart(window.fromMs, reset); start < window.untilMs; start = lootWeekEnd(start, reset)) {
    starts.push(seconds(start));
  }
  return starts;
}

export function lootQuery(database: string, window: ChronicleWindow, reset: LootReset): string {
  const starts = lootWeekStarts(window, reset);
  return `
    SELECT player_id, sum(week_peak) AS loot_total, max(week_peak) AS best_week_loot,
      toString(toDate(toDateTime(arrayElement([${starts.join(',')}], argMax(week, week_peak))))) AS best_week_start,
      groupArray((week, week_peak)) AS weeks
    FROM (
      SELECT player_id, arrayLastIndex(x -> x <= toUnixTimestamp(created_at), [${starts.join(',')}]) AS week,
        toInt64(max(point)) AS week_peak
      FROM \`${database}\`.player_loot_history
      WHERE ${inWindow(window)}
      GROUP BY player_id, week
    )
    GROUP BY player_id`;
}

function lootGains(database: string, window: ChronicleWindow): string {
  return `
    SELECT player_id, created_at FROM (
      SELECT player_id, created_at,
        toInt64(point) - lagInFrame(toInt64(point)) OVER (PARTITION BY player_id ORDER BY created_at ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS gain,
        row_number() OVER (PARTITION BY player_id ORDER BY created_at) AS position
      FROM \`${database}\`.player_loot_history
      WHERE ${inWindow(window)}
    )
    WHERE gain > 0 AND position > 1`;
}

export function activeHoursQuery(database: string, window: ChronicleWindow, timezone: string): string {
  return `
    SELECT player_id, sumMap([toHour(created_at, '${timezone}')], [toUInt32(1)]) AS hours
    FROM (${lootGains(database, window)})
    GROUP BY player_id`;
}

export function activeDaysQuery(database: string, window: ChronicleWindow, timezone: string): string {
  return `
    SELECT player_id, groupUniqArray(toString(toDate(created_at, '${timezone}'))) AS days
    FROM (${lootGains(database, window)})
    GROUP BY player_id`;
}

export function eventDatesQuery(database: string, window: ChronicleWindow): string {
  return `
    SELECT table_name, arraySort(groupArray(toUnixTimestamp(created_at))) AS hours
    FROM \`${database}\`.event_dates
    WHERE ${inWindow(window)}
    GROUP BY table_name`;
}

export function eventRunStarts(hours: number[]): number[] {
  return hours.filter((hour, index) => index === 0 || hour - hours[index - 1] > EVENT_RUN_GAP_SECONDS);
}

export function eventResultsQuery(
  database: string,
  table: string,
  window: ChronicleWindow,
  runStarts: number[],
): string {
  return `
    SELECT player_id, count() AS runs, min(position) AS best_rank, countIf(position <= 3) AS podiums
    FROM (
      SELECT player_id, rank() OVER (PARTITION BY run ORDER BY score DESC) AS position
      FROM (
        SELECT player_id, arrayLastIndex(x -> x <= toUnixTimestamp(created_at), [${runStarts.join(',')}]) AS run,
          max(point) AS score
        FROM \`${database}\`.${table}
        WHERE ${inWindow(window)} AND point > 0
        GROUP BY player_id, run
      )
    )
    GROUP BY player_id`;
}

export const PLAYERS_SQL = `
  SELECT p.id, p.name, p.alliance_id, a.name AS alliance_name, p.current_fame, p.highest_fame
  FROM players p LEFT JOIN alliances a ON a.id = p.alliance_id`;

export function worldEventSql(ranking: string, events: string): string {
  return `
    WITH monthly AS (
      SELECT r.server, r.player_id, to_char(e.collect_date, 'YYYYMM')::int AS month,
        min(r.rank) AS best_rank, max(r.point) AS best_point, count(*) AS played
      FROM ${ranking} r JOIN ${events} e USING (event_num)
      WHERE e.collect_date >= to_timestamp($1) AND e.collect_date < to_timestamp($2) AND r.player_id IS NOT NULL
      GROUP BY r.server, r.player_id, month
    )
    SELECT server, player_id, sum(played)::int AS events, min(best_rank) AS best_rank, max(best_point) AS best_point,
      array_agg(month ORDER BY month) AS months, array_agg(best_rank ORDER BY month) AS ranks
    FROM monthly
    GROUP BY server, player_id`;
}

export const ALLIANCE_CHANGES_SQL = `
  SELECT player_id, old_alliance_name, new_alliance_name, created_at
  FROM player_alliance_update
  WHERE created_at >= to_timestamp($1) AND created_at < to_timestamp($2)
  ORDER BY player_id, created_at`;
