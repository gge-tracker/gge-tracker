import { AbstractFilterBuilder } from './abstract-filter-builder';

export class PlayerFilters extends AbstractFilterBuilder<PlayerFilters> {
  public honor(min?: number, max?: number): PlayerFilters {
    this.addMany([this.min('P.honor', min), this.max('P.honor', max)]);
    return this.self();
  }

  public might(min?: number, max?: number): PlayerFilters {
    this.addMany([this.min('P.might_current', min), this.max('P.might_current', max)]);
    return this.self();
  }

  public allianceId(allianceId?: number): PlayerFilters {
    if (allianceId !== undefined) {
      this.add(this.eq('P.alliance_id', allianceId));
    }
    return this.self();
  }

  public allianceStatus(filter?: number): PlayerFilters {
    if (filter === 0) this.add(this.raw('P.alliance_id IS NULL'));
    if (filter === 1) this.add(this.raw('P.alliance_id IS NOT NULL'));
    return this.self();
  }

  public fame(min?: number, max?: number): PlayerFilters {
    this.addMany([this.min('P.current_fame', min), this.max('P.current_fame', max)]);
    return this.self();
  }

  public loot(min?: number, max?: number): PlayerFilters {
    this.addMany([this.min('P.loot_current', min), this.max('P.loot_current', max)]);
    return this.self();
  }

  public level(min?: number, max?: number): PlayerFilters {
    this.addMany([this.min('P.level', min), this.max('P.level', max)]);
    return this.self();
  }

  public legendaryLevel(min?: number, max?: number): PlayerFilters {
    this.addMany([this.min('P.legendary_level', min), this.max('P.legendary_level', max)]);
    return this.self();
  }

  public name(name?: string, searchType?: string): PlayerFilters {
    if (searchType === 'player' && name) {
      this.add(this.eq('P.name', name));
    }
    return this.self();
  }

  public activity(filter?: number): PlayerFilters {
    if (filter === 1) {
      this.add(this.raw(`(P.castles IS NOT NULL AND jsonb_array_length(P.castles) > 0)`));
    }

    if (filter === 0) {
      this.add(this.raw(`(P.castles IS NULL OR jsonb_array_length(P.castles) = 0)`));
    }

    return this.self();
  }

  public stormyIslandsFilter(stormyIslandsFilter?: number): PlayerFilters {
    if (stormyIslandsFilter === 1) {
      this.add(
        this.raw(`
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(P.castles_realm) elem
          WHERE (elem->>0)::int = 4
        )
      `),
      );
    } else if (stormyIslandsFilter === 0) {
      this.add(
        this.raw(`
        NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(P.castles_realm) elem
          WHERE (elem->>0)::int = 4
        )
      `),
      );
    }
    return this.self();
  }

  public kingdom(kingdomIds?: number[]): PlayerFilters {
    const ids = kingdomIds || [];
    const allIds = [1, 2, 3];

    if (ids.length === 0) {
      this.add(this.raw(`(P.castles_realm IS NULL OR jsonb_array_length(P.castles_realm) = 0)`));
      return this.self();
    } else if (ids.includes(999)) {
      // No filter, include all kingdoms
      return this.self();
    }
    for (const id of ids) {
      this.add(
        this.raw(`
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(P.castles_realm) elem
            WHERE (elem->>0)::int = ${id}
          )
        `),
      );
    }
    const excluded = allIds.filter((id) => !ids.includes(id));
    for (const id of excluded) {
      this.add(
        this.raw(`
          NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(P.castles_realm) elem
            WHERE (elem->>0)::int = ${id}
          )
        `),
      );
    }

    return this.self();
  }
}
