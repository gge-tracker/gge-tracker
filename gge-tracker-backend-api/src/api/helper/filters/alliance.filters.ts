import { ApiHelper } from '../api-helper';
import { AbstractFilterBuilder } from './abstract-filter-builder';

export class AllianceFilters extends AbstractFilterBuilder<AllianceFilters> {
  public presence(filter?: number): AllianceFilters {
    if (filter === 0) this.add(this.raw('P.alliance_id IS NULL'));
    if (filter === 1) this.add(this.raw('P.alliance_id IS NOT NULL'));
    return this.self();
  }

  public byIdOrName(allianceId?: number | string, searchType?: string, searchInput?: string): AllianceFilters {
    if (allianceId) {
      this.add(this.eq('A.id', ApiHelper.removeCountryCode(Number(allianceId))));
    } else if (searchType === 'alliance' && searchInput) {
      this.add(this.eq('A.name', ApiHelper.removeCountryCode(searchInput)));
    }
    return this.self();
  }

  public name(allianceName: string): AllianceFilters {
    if (allianceName) {
      this.add(this.eq('A.name', ApiHelper.removeCountryCode(allianceName)));
    }
    return this.self();
  }

  public excludeRanks(ranks?: readonly number[] | string): AllianceFilters {
    if (typeof ranks === 'string') return this.self();
    this.add(this.notIn('P.alliance_rank', ranks));
    return this.self();
  }
}
