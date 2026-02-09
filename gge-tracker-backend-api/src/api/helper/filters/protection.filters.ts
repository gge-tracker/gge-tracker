import { AbstractFilterBuilder } from './abstract-filter-builder';

export class ProtectionFilters extends AbstractFilterBuilder<ProtectionFilters> {
  public status(protectionFilter?: number, banFilter?: number): ProtectionFilters {
    if (protectionFilter === 0 && banFilter !== 1) {
      this.add(this.raw(`(P.peace_disabled_at IS NULL OR P.peace_disabled_at <= NOW())`));
    }
    if (protectionFilter === 1) {
      this.add(this.raw(`P.peace_disabled_at IS NOT NULL AND P.peace_disabled_at > NOW()`));
    }
    return this.self();
  }

  public ban(banFilter?: number): ProtectionFilters {
    if (banFilter === 0) {
      this.add(this.raw(`(P.peace_disabled_at IS NULL OR P.peace_disabled_at <= NOW() + INTERVAL '63 days')`));
    }
    if (banFilter === 1) {
      this.add(this.raw(`P.peace_disabled_at > NOW() + INTERVAL '63 days'`));
    }
    return this.self();
  }
}
