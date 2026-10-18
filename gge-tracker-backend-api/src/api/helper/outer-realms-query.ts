import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import {
  OuterRealmsArea,
  OuterRealmsBoard,
  OuterRealmsFilter,
  OuterRealmsMetric,
  OuterRealmsMovement,
  OuterRealmsRange,
  OuterRealmsSort,
  OuterRealmsSortField,
} from './cache/outer-realms-board';
import { qFlag, toQueryText } from './parse-query';

export interface OuterRealmsQuery {
  filter: OuterRealmsFilter;
  sort: OuterRealmsSort;
}

interface RangeParameter {
  metric: OuterRealmsMetric;
  max: number;
  error: RouteErrorMessagesEnum;
}

type ParseResult<T> = T | { error: RouteErrorMessagesEnum };

/**
 * Reads the filters and sort shared by the live Outer Realms ranking and its export
 */
export abstract class OuterRealmsQueryParser {
  public static readonly MAX_SERVERS = 60;
  public static readonly DEFAULT_RADIUS = 50;
  public static readonly MAX_RADIUS = 1500;
  public static readonly MAX_COORDINATE = 9999;

  private static readonly SERVER_PATTERN = /^[\dA-Z]{2,8}$/;
  private static readonly UNSIGNED_INTEGER_PATTERN = /^\d{1,15}$/;
  private static readonly COORDINATES_PATTERN = /^(\d{1,4}),(\d{1,4})$/;
  private static readonly MOVEMENTS: OuterRealmsMovement[] = ['up', 'down', 'steady'];
  private static readonly SORT_FIELDS: OuterRealmsSortField[] = [
    'rank',
    'score',
    'might',
    'level',
    'score_diff',
    'rank_diff',
    'player_name',
    'distance',
  ];
  private static readonly ASCENDING_BY_DEFAULT = new Set<OuterRealmsSortField>(['rank', 'player_name', 'distance']);
  private static readonly RANGES: RangeParameter[] = [
    { metric: 'level', max: 2000, error: RouteErrorMessagesEnum.InvalidLevel },
    { metric: 'might', max: Number.MAX_SAFE_INTEGER, error: RouteErrorMessagesEnum.InvalidMight },
    { metric: 'score', max: Number.MAX_SAFE_INTEGER, error: RouteErrorMessagesEnum.InvalidScore },
    { metric: 'rank', max: 10_000_000, error: RouteErrorMessagesEnum.InvalidRank },
  ];

  public static parse(request: express.Request, name: string | null): OuterRealmsQuery | RouteErrorMessagesEnum {
    const servers = this.parseServers(request.query.server);
    if (this.isError(servers)) return servers.error;
    const ranges = this.parseRanges(request);
    if (this.isError(ranges)) return ranges.error;
    const movement = this.parseMovement(request.query.movement);
    if (this.isError(movement)) return movement.error;
    const near = this.parseArea(request.query.near, request.query.radius);
    if (this.isError(near)) return near.error;
    const filter: OuterRealmsFilter = {
      name,
      servers,
      ranges,
      activeOnly: qFlag().parse(request.query.active) === 1,
      movement,
      near,
    };
    const sort = this.parseSort(request.query.order_by, request.query.order_dir, filter.near !== null);
    if (this.isError(sort)) return sort.error;
    return { filter, sort };
  }

  public static describe(query: OuterRealmsQuery): string {
    return JSON.stringify(query);
  }

  public static isDefault(query: OuterRealmsQuery): boolean {
    const { field, descending } = OuterRealmsBoard.DEFAULT_SORT;
    return (
      OuterRealmsBoard.isUnfiltered(query.filter) && query.sort.field === field && query.sort.descending === descending
    );
  }

  private static isError<T>(parsed: ParseResult<T>): parsed is { error: RouteErrorMessagesEnum } {
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'error' in parsed;
  }

  private static parseServers(raw: unknown): ParseResult<string[]> {
    const text = this.textOf(raw);
    if (text === null) return [];
    if (text === undefined) return { error: RouteErrorMessagesEnum.InvalidServer };
    const servers = [...new Set(text.toUpperCase().split(','))].sort();
    if (servers.length > this.MAX_SERVERS || !servers.every((server) => this.SERVER_PATTERN.test(server))) {
      return { error: RouteErrorMessagesEnum.InvalidServer };
    }
    return servers;
  }

  private static parseRanges(request: express.Request): ParseResult<OuterRealmsRange[]> {
    const ranges: OuterRealmsRange[] = [];
    for (const { metric, max, error } of this.RANGES) {
      const minimum = this.parseBound(request.query[`min_${metric}`], max);
      const maximum = this.parseBound(request.query[`max_${metric}`], max);
      if (minimum === undefined || maximum === undefined) return { error };
      if (minimum !== null || maximum !== null) ranges.push({ metric, min: minimum, max: maximum });
    }
    return ranges;
  }

  private static parseBound(raw: unknown, max: number): number | null | undefined {
    const text = this.textOf(raw);
    if (text === null) return null;
    if (text === undefined || !this.UNSIGNED_INTEGER_PATTERN.test(text)) return undefined;
    const value = Number(text);
    return value <= max ? value : undefined;
  }

  private static parseMovement(raw: unknown): ParseResult<OuterRealmsMovement | null> {
    const text = this.textOf(raw);
    if (text === null) return null;
    const movement = this.MOVEMENTS.find((candidate) => candidate === text?.toLowerCase());
    return movement ?? { error: RouteErrorMessagesEnum.InvalidMovement };
  }

  private static parseArea(rawNear: unknown, rawRadius: unknown): ParseResult<OuterRealmsArea | null> {
    const near = this.textOf(rawNear);
    if (near === null) return null;
    const coordinates = near === undefined ? null : this.COORDINATES_PATTERN.exec(near.replaceAll(' ', ''));
    if (!coordinates) return { error: RouteErrorMessagesEnum.InvalidPosition };
    const radius = this.parseBound(rawRadius, this.MAX_RADIUS);
    if (radius === undefined || radius === 0) return { error: RouteErrorMessagesEnum.InvalidRadius };
    return { x: Number(coordinates[1]), y: Number(coordinates[2]), radius: radius ?? this.DEFAULT_RADIUS };
  }

  private static parseSort(rawField: unknown, rawDirection: unknown, hasArea: boolean): ParseResult<OuterRealmsSort> {
    const fieldText = this.textOf(rawField);
    const field =
      fieldText === null
        ? OuterRealmsBoard.DEFAULT_SORT.field
        : this.SORT_FIELDS.find((candidate) => candidate === fieldText?.toLowerCase());
    if (!field || (field === 'distance' && !hasArea)) return { error: RouteErrorMessagesEnum.InvalidSortField };

    const directionText = this.textOf(rawDirection);
    if (directionText === null) return { field, descending: !this.ASCENDING_BY_DEFAULT.has(field) };
    const direction = directionText?.toLowerCase();
    if (direction !== 'asc' && direction !== 'desc') return { error: RouteErrorMessagesEnum.InvalidSortDirection };
    return { field, descending: direction === 'desc' };
  }

  // null: absent or blank, undefined: not a plain value (a nested object), refused by every caller
  private static textOf(raw: unknown): string | null | undefined {
    if (raw === undefined) return null;
    const text = toQueryText(raw)?.trim();
    if (text === undefined) return undefined;
    return text === '' ? null : text;
  }
}
