import * as fs from 'node:fs';
import path from 'node:path';
// imported from https://github.com/476f6f6467616d6553747564696f73/E4K-data/blob/main/data/divisionRounds.json
import empireFourKingdomsDivisionRounds from '../game-data/e4k-division-rounds.json';
import { ApiHelper } from './api-helper';
import { RankingGame } from './ranking-universe';

export interface DivisionRound {
  id: number;
  eventId: number;
  type: string;
  divisions: number;
  subdivisions: number[];
  subdivisionSizes: number[];
  promotes: number[];
  demotes: number[];
}

export interface PublicDivisionRound {
  id: number;
  type: string;
  promotes: number[];
  demotes: number[];
}

type RawDivisionRound = Record<string, string | number | undefined>;

export abstract class DivisionRounds {
  public static readonly REDIS_KEY = 'division-rounds:known';
  public static readonly QUALIFICATION = 'qualification';
  public static readonly GRAND_TOURNAMENT_EVENT_ID = 129;
  public static readonly RIFT_RAID_EVENT_ID = 133;
  private static readonly SYNC_INTERVAL_MS = 60 * 1000;
  private static readonly ASSETS_DIRECTORY = path.join(__dirname, './../assets/');
  private static readonly EP_FILE = path.join(this.ASSETS_DIRECTORY, 'division-rounds.json');
  private static readonly ITEMS_FILE = path.join(this.ASSETS_DIRECTORY, 'items.json');
  private static readonly E4K_ROUNDS = DivisionRounds.parse(empireFourKingdomsDivisionRounds as RawDivisionRound[]);

  private static epRounds: DivisionRound[] | null = null;
  private static timer: ReturnType<typeof setInterval> | null = null;

  public static start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.publishKnownIds(), this.SYNC_INTERVAL_MS);
    void this.publishKnownIds();
  }

  public static async find(
    game: RankingGame,
    eventId: number,
    divisionRoundId: number | null,
  ): Promise<DivisionRound | null> {
    if (divisionRoundId === null) return null;
    const rounds = await this.roundsOf(game);
    return rounds.find((round) => round.id === divisionRoundId && round.eventId === eventId) ?? null;
  }

  public static toPublic(round: DivisionRound | null): PublicDivisionRound | null {
    if (!round) return null;
    return { id: round.id, type: round.type, promotes: round.promotes, demotes: round.demotes };
  }

  public static async publishFromItems(items: { divisionRounds?: unknown }): Promise<void> {
    if (!Array.isArray(items.divisionRounds)) return;
    this.epRounds = this.parse(items.divisionRounds as RawDivisionRound[]);
    await fs.promises.writeFile(this.EP_FILE, JSON.stringify(items.divisionRounds));
    await this.publishKnownIds();
  }

  public static projectedDivision(
    round: DivisionRound,
    division: number,
    rank: number,
    subdivisionSize: number,
  ): number {
    if (round.type === this.QUALIFICATION) return this.qualifiedDivision(round, rank);
    const promotes = round.promotes[division - 1] ?? 0;
    const demotes = round.demotes[division - 1] ?? 0;
    if (rank <= promotes) return Math.min(division + 1, round.promotes.length);
    if (demotes > 0 && rank >= subdivisionSize - demotes + 1) return Math.max(division - 1, 1);
    return division;
  }

  // Each division's promotes count the places of the seeding ranking that land in it, the top division's first
  private static qualifiedDivision(round: DivisionRound, rank: number): number {
    let placesAbove = 0;
    for (let division = round.promotes.length; division >= 2; division--) {
      placesAbove += round.promotes[division - 1];
      if (rank <= placesAbove) return division;
    }
    return 1;
  }

  private static async roundsOf(game: RankingGame): Promise<DivisionRound[]> {
    if (game === 'e4k') return this.E4K_ROUNDS;
    this.epRounds ??= await this.loadEpRounds();
    return this.epRounds;
  }

  private static async loadEpRounds(): Promise<DivisionRound[]> {
    try {
      const extracted = await fs.promises.readFile(this.EP_FILE);
      return this.parse(JSON.parse(extracted.toString()));
    } catch {
      try {
        const itemsFile = await fs.promises.readFile(this.ITEMS_FILE);
        const items = JSON.parse(itemsFile.toString());
        if (!Array.isArray(items.divisionRounds)) return [];
        await fs.promises.writeFile(this.EP_FILE, JSON.stringify(items.divisionRounds));
        return this.parse(items.divisionRounds);
      } catch {
        return [];
      }
    }
  }

  private static async publishKnownIds(): Promise<void> {
    try {
      const epRounds = await this.roundsOf('ep');
      const known = {
        ep: epRounds.map((round) => round.id),
        e4k: this.E4K_ROUNDS.map((round) => round.id),
      };
      if (known.ep.length === 0) return;
      await ApiHelper.redisClient.set(this.REDIS_KEY, JSON.stringify(known));
    } catch (error) {
      ApiHelper.logError(error, 'DivisionRounds.publishKnownIds', null);
    }
  }

  private static parse(rows: RawDivisionRound[]): DivisionRound[] {
    return rows
      .map((row) => ({
        id: Number(row.divisionRoundID),
        eventId: Number(row.eventID),
        type: String(row.type ?? ''),
        divisions: Number(row.divisions),
        subdivisions: this.integers(row.subdivisions),
        subdivisionSizes: this.integers(row.subdivisionSizes),
        promotes: this.integers(row.promotes),
        demotes: this.integers(row.demotes),
      }))
      .filter((round) => Number.isInteger(round.id) && round.promotes.length > 0);
  }

  private static integers(value: string | number | undefined): number[] {
    if (value === undefined || value === '') return [];
    return String(value)
      .split(',')
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isInteger(part));
  }
}
