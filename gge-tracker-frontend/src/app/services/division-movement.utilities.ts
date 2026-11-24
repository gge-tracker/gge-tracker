import { ApiDivisionRound } from '@ggetracker-interfaces/empire-ranking';

export type DivisionMovement = 'up' | 'down';

export interface DivisionRule {
  type: ApiDivisionRound['type'];
  promotes: number;
  demotes: number;
}

export function divisionMovement(projected: number | null | undefined, current: number): DivisionMovement | null {
  if (projected === null || projected === undefined) return null;
  if (projected > current) return 'up';
  return projected < current ? 'down' : null;
}

export function divisionRule(round: ApiDivisionRound | null, division: number): DivisionRule | null {
  const index = division - 1;
  if (!round || index < 0) return null;
  return { type: round.type, promotes: round.promotes[index] ?? 0, demotes: round.demotes[index] ?? 0 };
}
