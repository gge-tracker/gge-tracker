import { AbstractFilterBuilder } from './abstract-filter-builder';

export class MovementFilters extends AbstractFilterBuilder<MovementFilters> {
  public castleType(value?: number): MovementFilters {
    if (value !== undefined && value !== -1) {
      this.add(this.eq('M.castle_type', value));
    }
    return this.self();
  }

  public movementType(value?: number): MovementFilters {
    if (value === -1 || value === undefined) return this.self();
    const map: Record<number, 'add' | 'remove' | 'move'> = {
      1: 'add',
      2: 'remove',
      3: 'move',
    };
    this.add(this.eq('M.movement_type', map[value]));
    return this.self();
  }
}
