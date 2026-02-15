import { SqlCondition, SqlPrimitive, SqlValue } from '../../interfaces/interfaces';
import { QueryFilterService } from './query-filter.service';

export abstract class AbstractFilterBuilder<TSelf> {
  protected readonly conditions: string[];
  protected readonly values: SqlValue[];
  protected readonly queryFilterService: QueryFilterService;

  constructor(conditions: string[], values: SqlValue[], queryFilterService: QueryFilterService) {
    this.conditions = conditions;
    this.values = values;
    this.queryFilterService = queryFilterService;
  }

  protected add(condition?: SqlCondition | null): void {
    if (!condition) return;
    if (Array.isArray(condition.value)) {
      const sql = condition.sql.replaceAll('?', () => `$${this.queryFilterService.getNextParameterIndex()}`);
      this.conditions.push(sql);
      this.values.push(...condition.value);
      return;
    }
    if (condition.value === undefined) {
      this.conditions.push(condition.sql);
    } else {
      this.conditions.push(condition.sql.replace('?', `$${this.queryFilterService.getNextParameterIndex()}`));
      this.values.push(condition.value);
    }
  }

  protected addMany(conditions: (SqlCondition | null | undefined)[]): void {
    conditions.forEach((c) => this.add(c));
  }

  protected min(sql: string, value?: number): SqlCondition | null {
    return value !== undefined && value >= 0 && !Number.isNaN(value) ? { sql: `${sql} >= ?`, value } : null;
  }

  protected max(sql: string, value?: number): SqlCondition | null {
    return value !== undefined && value >= 0 && !Number.isNaN(value) ? { sql: `${sql} <= ?`, value } : null;
  }

  protected eq<T extends SqlValue>(sql: string, value?: T): SqlCondition | null {
    return value !== undefined && value !== null ? { sql: `${sql} = ?`, value } : null;
  }

  protected raw(sql: string): SqlCondition {
    return { sql };
  }

  protected self(): TSelf {
    return this as unknown as TSelf;
  }

  protected notIn<T extends SqlPrimitive>(sql: string, values?: readonly T[]): SqlCondition | null {
    if (!values || values.length === 0) return null;

    const placeholders = values.map(() => `$${this.queryFilterService.getNextParameterIndex()}`).join(', ');
    return {
      sql: `${sql} NOT IN (${placeholders})`,
      value: values,
    };
  }
}
