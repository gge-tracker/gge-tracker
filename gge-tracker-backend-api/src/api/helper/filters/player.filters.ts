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
}
