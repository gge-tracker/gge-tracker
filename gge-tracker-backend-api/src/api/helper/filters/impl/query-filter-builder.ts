import { SqlValue } from '../../../interfaces/interfaces';
import { AllianceFilters } from '../alliance.filters';
import { CastleFilters } from '../castle.filters';
import { MovementFilters } from '../movement.filters';
import { PlayerFilters } from '../player.filters';
import { ProtectionFilters } from '../protection.filters';
import { QueryFilterService } from '../query-filter.service';

export class QueryFilterBuilder {
  private readonly conditions: string[] = [];
  private readonly values: SqlValue[] = [];
  private queryFilterService = new QueryFilterService();

  constructor(parameterIndex?: number) {
    if (parameterIndex) {
      this.queryFilterService.setParameterIndex(parameterIndex);
    }
  }

  public player(): PlayerFilters {
    return new PlayerFilters(this.conditions, this.values, this.queryFilterService);
  }

  public castle(): CastleFilters {
    return new CastleFilters(this.conditions, this.values, this.queryFilterService);
  }

  public protection(): ProtectionFilters {
    return new ProtectionFilters(this.conditions, this.values, this.queryFilterService);
  }

  public alliance(): AllianceFilters {
    return new AllianceFilters(this.conditions, this.values, this.queryFilterService);
  }

  public movement(): MovementFilters {
    return new MovementFilters(this.conditions, this.values, this.queryFilterService);
  }

  public build(): { where: string; values: SqlValue[] } {
    return {
      where: this.conditions.length > 0 ? `WHERE ${this.conditions.join(' AND ')}` : '',
      values: this.values,
    };
  }

  public getLastParameterIndex(): number {
    return this.queryFilterService.parameterIndex;
  }
}
