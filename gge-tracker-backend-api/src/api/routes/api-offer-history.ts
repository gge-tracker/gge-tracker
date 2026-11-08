import * as express from 'express';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { CachedResponse } from '../helper/cache/cached-response';
import { RankingGame, RankingUniverse } from '../helper/ranking-universe';
import { OfferSnapshot } from '../services/offer-snapshot';
import { StoreCatalogClient } from '../services/store-catalog-client';
import { ApiOffers } from './api-offers';

interface OfferSlotsRow {
  offer_id: string;
  slots: number[];
}

interface OfferRun {
  startIndex: number;
  endIndex: number;
}

interface CollectedProfile {
  level: number;
  legendaryLevel: number;
}

export abstract class ApiOfferHistory implements ApiHelper {
  private static readonly TABLE = 'ggetracker_global.store_offer_history';
  private static readonly CACHE_TTL_SECONDS = 3600;
  private static readonly MISSING_SCHEMA_ERRORS = new Set(['UNKNOWN_TABLE', 'UNKNOWN_IDENTIFIER']);
  private static readonly EMPTY_HISTORY = { first_snapshot_at: null, last_snapshot_at: null, offers: [] };

  public static async getOfferHistory(request: express.Request, response: express.Response): Promise<void> {
    try {
      const level = Number.parseInt(String(request.query.level ?? ApiOffers.MAX_LEVEL));
      const legendaryLevel = Number.parseInt(String(request.query.legendaryLevel ?? 0));
      const invalidLevel = ApiOffers.findLevelError(level, legendaryLevel);
      if (invalidLevel) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: invalidLevel });
        return;
      }
      const game = RankingUniverse.gameOfServerName(String(request['language']));
      const profile = this.collectedProfile(level, legendaryLevel);
      const cacheKey = new CacheKeyBuilder('offer-history').withParams({ game, ...profile }).build();
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const rows = await this.readOfferSlots(game, profile);
      if (rows === null) {
        response.status(ApiHelper.HTTP_OK).send(this.EMPTY_HISTORY);
        return;
      }
      await CachedResponse.serve(response, cacheKey, this.toHistory(rows), this.CACHE_TTL_SECONDS);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getOfferHistory', request);
    }
  }

  private static collectedProfile(level: number, legendaryLevel: number): CollectedProfile {
    if (level < ApiOffers.MAX_LEVEL) {
      return { level: ApiOffers.roundUpToRange(level, ApiOffers.LEVEL_RANGE_BOUNDS), legendaryLevel: 0 };
    }
    return {
      level: ApiOffers.MAX_LEVEL,
      legendaryLevel: ApiOffers.roundUpToRange(legendaryLevel, ApiOffers.LEGENDARY_RANGE_BOUNDS),
    };
  }

  private static async readOfferSlots(game: RankingGame, profile: CollectedProfile): Promise<OfferSlotsRow[] | null> {
    const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    try {
      const result = await clickhouseClient.query({
        query: `SELECT offer_id, arraySort(groupArray(slot)) AS slots
          FROM (
            SELECT DISTINCT offer_id, toUnixTimestamp(snapshot_at) AS slot
            FROM ${this.TABLE}
            WHERE game = {game:String}
              AND currency = {currency:String}
              AND level = {level:UInt8}
              AND legendary_level = {legendaryLevel:UInt16}
          )
          GROUP BY offer_id`,
        query_params: { game, currency: StoreCatalogClient.REFERENCE_CURRENCY, ...profile },
        format: 'JSONEachRow',
      });
      return await result.json<OfferSlotsRow>();
    } catch (error) {
      if (this.MISSING_SCHEMA_ERRORS.has((error as { type?: string }).type ?? '')) return null;
      throw error;
    }
  }

  private static toHistory(rows: OfferSlotsRow[]): object {
    const collectedSlots = [...new Set(rows.flatMap((row) => row.slots))].sort((a, b) => a - b);
    if (collectedSlots.length === 0) return this.EMPTY_HISTORY;
    const slotIndexes = new Map(collectedSlots.map((slot, index) => [slot, index]));
    const iso = (index: number): string => new Date(collectedSlots[index] * 1000).toISOString();
    return {
      first_snapshot_at: iso(0),
      last_snapshot_at: iso(collectedSlots.length - 1),
      offers: rows.map(({ offer_id, slots }) => {
        const runs = this.splitIntoRuns(slots.map((slot) => slotIndexes.get(slot) as number));
        const currentRun = runs.at(-1) as OfferRun;
        const previousRun = runs.at(-2);
        const lastCompletedRun = runs.findLast((run) => run.startIndex > 0 && run.endIndex < collectedSlots.length - 1);
        return {
          id: offer_id,
          first_seen_at: iso(runs[0].startIndex),
          last_seen_at: iso(currentRun.endIndex),
          run_started_at: iso(currentRun.startIndex),
          previous_run_ended_at: previousRun ? iso(previousRun.endIndex) : null,
          last_completed_run_hours: lastCompletedRun ? this.runHours(lastCompletedRun, collectedSlots) : null,
          runs: runs.length,
        };
      }),
    };
  }

  private static runHours(run: OfferRun, collectedSlots: number[]): number {
    return (collectedSlots[run.endIndex] - collectedSlots[run.startIndex]) / 3600 + OfferSnapshot.SLOT_HOURS;
  }

  private static splitIntoRuns(sortedSlotIndexes: number[]): OfferRun[] {
    const runs: OfferRun[] = [];
    for (const index of sortedSlotIndexes) {
      const current = runs.at(-1);
      if (current?.endIndex === index - 1) {
        current.endIndex = index;
      } else {
        runs.push({ startIndex: index, endIndex: index });
      }
    }
    return runs;
  }
}
