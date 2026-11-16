import { ApiWoaEventListResponse, WoaDifficulty, WoaEventCompetition } from '@ggetracker-interfaces/empire-ranking';

type WoaEventRow = ApiWoaEventListResponse['events'][number];
type WoaStats = NonNullable<ApiWoaEventListResponse['stats']>;

export const WOA_DIFFICULTY_LEVELS: WoaDifficulty[] = ['calm', 'normal', 'contested', 'fierce'];

export const WOA_DIFFICULTY_LABELS: Record<WoaDifficulty, string> = {
  calm: 'Calme',
  normal: 'Normal',
  contested: 'Disputé',
  fierce: 'Acharné',
};

export abstract class WoaCompetition {
  public static of(event: WoaEventRow, stats: WoaStats | undefined): WoaEventCompetition | undefined {
    if (!stats || event.top10_score === undefined || event.top1_score === undefined) return undefined;
    return {
      top1Score: event.top1_score,
      top10Score: event.top10_score,
      top10Floor: WoaCompetition.floorOf(event.top10_score, stats.prize_floors),
      floorCount: stats.prize_floors.length + 1,
      topFloorPlayers: event.top_floor_players ?? 0,
      difficulty: WoaCompetition.difficultyOf(event.top10_score, stats.top10_score_quartiles),
    };
  }

  public static floorOf(score: number, floors: number[]): number {
    return 1 + floors.filter((floor) => score >= floor).length;
  }

  private static difficultyOf(score: number, quartiles: WoaStats['top10_score_quartiles']): WoaDifficulty | null {
    if (!quartiles) return null;
    const [lower, median, upper] = quartiles;
    if (score < lower) return 'calm';
    if (score < median) return 'normal';
    if (score < upper) return 'contested';
    return 'fierce';
  }
}
