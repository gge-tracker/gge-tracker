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
      this.add(this.eq('LOWER(A.name)', searchInput.trim().toLowerCase()));
    }
    return this.self();
  }

  public name(allianceName: string): AllianceFilters {
    if (allianceName) {
      this.add(this.eq('LOWER(A.name)', allianceName.trim().toLowerCase()));
    }
    return this.self();
  }

  public membersCount(min?: number, max?: number): AllianceFilters {
    this.addMany([this.min('COUNT(P.id)', min), this.max('COUNT(P.id)', max)]);
    return this.self();
  }

  public might(min?: number, max?: number): AllianceFilters {
    this.addMany([this.min('might_current', min), this.max('might_current', max)]);
    return this.self();
  }

  public mightSubquery(min?: number, max?: number): AllianceFilters {
    if (min === undefined && max === undefined) return this.self();
    const havingParts: string[] = ['COUNT(P2.id) > 0'];
    const values: number[] = [];
    if (min !== undefined) {
      havingParts.push('SUM(P2.might_current) >= ?');
      values.push(min);
    }
    if (max !== undefined) {
      havingParts.push('SUM(P2.might_current) <= ?');
      values.push(max);
    }
    this.add({
      sql: `P.alliance_id IN (
        SELECT P2.alliance_id
        FROM players P2
        WHERE P2.alliance_id IS NOT NULL
        GROUP BY P2.alliance_id
        HAVING ${havingParts.join(' AND ')}
      )`,
      value: values,
    });
    return this.self();
  }

  public loot(min?: number, max?: number): AllianceFilters {
    this.addMany([this.min('loot_current', min), this.max('loot_current', max)]);
    return this.self();
  }

  public fame(min?: number, max?: number): AllianceFilters {
    this.addMany([this.min('current_fame', min), this.max('current_fame', max)]);
    return this.self();
  }

  public excludeRanks(ranks?: readonly number[] | string): AllianceFilters {
    if (typeof ranks === 'string') return this.self();
    this.add(this.notIn('P.alliance_rank', ranks));
    return this.self();
  }
}
