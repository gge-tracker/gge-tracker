import { AbstractFilterBuilder } from './abstract-filter-builder';

export class CastleFilters extends AbstractFilterBuilder<CastleFilters> {
  private static readonly CASTLE_COUNT_SQL = `(COALESCE(jsonb_array_length(P.castles), 0) + COALESCE(jsonb_array_length(P.castles_realm), 0))`;

  public count(min?: number, max?: number): CastleFilters {
    this.addMany([this.min(CastleFilters.CASTLE_COUNT_SQL, min), this.max(CastleFilters.CASTLE_COUNT_SQL, max)]);
    return this.self();
  }
}
