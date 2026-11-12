import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from './api-helper';

export type LeagueSubject = 'players' | 'alliances';

type QueryValue = string | number;

interface Bounds {
  min?: number;
  max?: number;
}

export interface LeagueFilter {
  day?: string;
  name?: string;
  allianceName?: string;
  allianceId?: number;
  title: Bounds;
  gold: Bounds;
  silver: Bounds;
  bronze: Bounds;
}

export interface LeagueFilterSql {
  conditions: string[];
  parameters: Record<string, QueryValue>;
}

const MEDALS = ['gold', 'silver', 'bronze'] as const;
const HIGHEST_TITLE = 21;
const MAX_MEDALS = 65_535;

export abstract class KingdomsLeagueFilter {
  public static parse(
    query: express.Request['query'],
    subject: LeagueSubject,
    code: string,
  ): LeagueFilter | RouteErrorMessagesEnum {
    const day = KingdomsLeagueFilter.parseDay(query.day);
    if (day === false) return RouteErrorMessagesEnum.InvalidDay;
    const nameKey = subject === 'players' ? 'player_name' : 'alliance_name';
    const name = KingdomsLeagueFilter.parseSearch(query[nameKey]);
    if (name === false) {
      return subject === 'players'
        ? RouteErrorMessagesEnum.InvalidPlayerName
        : RouteErrorMessagesEnum.InvalidAllianceName;
    }
    const medals = KingdomsLeagueFilter.parseMedals(query);
    if (!medals) return RouteErrorMessagesEnum.InvalidMedalCount;
    const filter: LeagueFilter = { day, name, title: {}, ...medals };
    if (subject === 'alliances') return filter;

    const allianceName = KingdomsLeagueFilter.parseSearch(query.alliance_name);
    if (allianceName === false) return RouteErrorMessagesEnum.InvalidAllianceName;
    const allianceId = KingdomsLeagueFilter.parseAllianceId(query.alliance_id, code);
    if (allianceId === false) return RouteErrorMessagesEnum.InvalidAllianceId;
    const title = KingdomsLeagueFilter.parseBounds(query.min_title, query.max_title, 1, HIGHEST_TITLE);
    if (!title) return RouteErrorMessagesEnum.InvalidLeagueTitle;
    return { ...filter, allianceName, allianceId, title };
  }

  public static toSql(filter: LeagueFilter, subject: LeagueSubject): LeagueFilterSql {
    const conditions: string[] = [];
    const parameters: Record<string, QueryValue> = {};
    const nameColumn = subject === 'players' ? 'player_name' : 'alliance_name';
    if (filter.name) {
      conditions.push(`positionCaseInsensitiveUTF8(${nameColumn}, {name:String}) > 0`);
      parameters.name = filter.name;
    }
    if (filter.allianceName) {
      conditions.push('positionCaseInsensitiveUTF8(alliance_name, {alliance_name:String}) > 0');
      parameters.alliance_name = filter.allianceName;
    }
    if (filter.allianceId !== undefined) {
      conditions.push('alliance_id = {alliance:Int32}');
      parameters.alliance = filter.allianceId;
    }
    for (const column of ['title', ...MEDALS] as const) {
      const bounds = filter[column];
      if (bounds.min !== undefined) {
        conditions.push(`${column} >= {min_${column}:UInt16}`);
        parameters[`min_${column}`] = bounds.min;
      }
      if (bounds.max !== undefined) {
        conditions.push(`${column} <= {max_${column}:UInt16}`);
        parameters[`max_${column}`] = bounds.max;
      }
    }
    return { conditions, parameters };
  }

  public static describe(filter: LeagueFilter): Record<string, string | number | undefined> {
    return {
      name: filter.name,
      alliance_name: filter.allianceName,
      alliance: filter.allianceId,
      title: KingdomsLeagueFilter.describeBounds(filter.title),
      gold: KingdomsLeagueFilter.describeBounds(filter.gold),
      silver: KingdomsLeagueFilter.describeBounds(filter.silver),
      bronze: KingdomsLeagueFilter.describeBounds(filter.bronze),
    };
  }

  public static parseDay(value: unknown): string | undefined | false {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    // undefined when absent, false when present
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : false;
  }

  private static parseMedals(query: express.Request['query']): Pick<LeagueFilter, 'gold' | 'silver' | 'bronze'> | null {
    const gold = KingdomsLeagueFilter.parseBounds(query.min_gold, query.max_gold, 0, MAX_MEDALS);
    const silver = KingdomsLeagueFilter.parseBounds(query.min_silver, query.max_silver, 0, MAX_MEDALS);
    const bronze = KingdomsLeagueFilter.parseBounds(query.min_bronze, query.max_bronze, 0, MAX_MEDALS);
    return gold && silver && bronze ? { gold, silver, bronze } : null;
  }

  private static parseBounds(minValue: unknown, maxValue: unknown, lowest: number, highest: number): Bounds | null {
    const min = KingdomsLeagueFilter.parseInteger(minValue, lowest, highest);
    const max = KingdomsLeagueFilter.parseInteger(maxValue, lowest, highest);
    if (min === false || max === false) return null;
    return { min, max };
  }

  private static parseInteger(value: unknown, lowest: number, highest: number): number | undefined | false {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return false;
    const parsed = Number(value);
    return parsed >= lowest && parsed <= highest ? parsed : false;
  }

  private static parseSearch(value: unknown): string | undefined | false {
    if (value === undefined || value === '') return undefined;
    const search = ApiHelper.validateSearchAndSanitize(value, { toLowerCase: false });
    return ApiHelper.isInvalidInput(search) || search === '' ? false : search;
  }

  private static parseAllianceId(value: unknown, code: string): number | undefined | false {
    if (value === undefined || value === '') return undefined;
    const allianceId = ApiHelper.verifyIdWithCountryCode(value);
    if (!allianceId || ApiHelper.getCountryCode(String(allianceId)) !== code) return false;
    return Number(ApiHelper.removeCountryCode(allianceId));
  }

  private static describeBounds(bounds: Bounds): string | undefined {
    if (bounds.min === undefined && bounds.max === undefined) return undefined;
    return `${bounds.min ?? ''}_${bounds.max ?? ''}`;
  }
}
