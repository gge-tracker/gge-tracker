import { QueryField } from '../interfaces/interfaces';

export const qNumber = (
  options: {
    min?: number;
    max?: number;
  } = {},
): QueryField<number | undefined> => ({
  parse: (value): number | undefined => {
    if (value === undefined) return;

    const n = Number.parseInt(String(value), 10);
    if (Number.isNaN(n)) return;
    if (options.min !== undefined && n < options.min) return;
    if (options.max !== undefined && n > options.max) return;

    return n;
  },
});

export const qString = (options: { max?: number } = {}): QueryField<string | undefined> => ({
  parse: (value): string | undefined => {
    if (value === undefined) return;
    const s = String(value).trim();
    if (options.max !== undefined && s.length > options.max) return undefined;
    return s.length > 0 ? s : undefined;
  },
});

export const qLowerString = (): QueryField<string | undefined> => ({
  parse: (value): string | undefined => {
    if (value === undefined) return;
    const s = String(value).trim().toLowerCase();
    return s.length > 0 ? s : undefined;
  },
});

export const qFlag = (): QueryField<0 | 1 | undefined> => ({
  parse: (value) => (value === '0' || value === 0 ? 0 : value === '1' || value === 1 ? 1 : undefined),
});

export const qLevelPair = (options: {
  maxLevel: number;
  maxLegendaryLevel: number;
}): QueryField<[number | undefined, number | undefined]> => ({
  parse: (value): [number | undefined, number | undefined] => {
    if (!value) return [undefined, undefined];

    const [a, b] = String(value).split('/');
    return [
      qNumber({ min: 0, max: options.maxLevel }).parse(a),
      qNumber({ min: 0, max: options.maxLegendaryLevel }).parse(b),
    ];
  },
});

export const qOrderType = (): QueryField<'ASC' | 'DESC'> => ({
  parse: (value): 'ASC' | 'DESC' | undefined => {
    if (typeof value !== 'string') return 'ASC';
    const s = value.trim().toUpperCase();
    return s === 'ASC' || s === 'DESC' ? s : 'ASC';
  },
});

export const qNumberArray = (): QueryField<number[] | undefined> => ({
  parse: (value): number[] | undefined => {
    if (!value) return;

    const array = String(value)
      .split(',')
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => !Number.isNaN(v));

    return array.length > 0 ? array : undefined;
  },
});

export const qOrderBy = (allowedValues: string[], defaultValue?: string): QueryField<string | undefined> => ({
  parse: (value): string | undefined => {
    if (typeof value !== 'string') return defaultValue;
    const s = value.trim();
    return allowedValues.includes(s) ? s : defaultValue;
  },
});

export const qSearchType = (): QueryField<string | undefined> => ({
  parse: (value): string | undefined => {
    if (typeof value !== 'string') return;
    const s = value.trim().toLowerCase();
    return s === 'player' || s === 'alliance' ? s : undefined;
  },
});

export interface QuerySchema {
  page: QueryField<number | undefined>;
  minHonor: QueryField<number | undefined>;
  maxHonor: QueryField<number | undefined>;
  minMight: QueryField<number | undefined>;
  maxMight: QueryField<number | undefined>;
  minLoot: QueryField<number | undefined>;
  maxLoot: QueryField<number | undefined>;
  minLevel: QueryField<[number | undefined, number | undefined]>;
  maxLevel: QueryField<[number | undefined, number | undefined]>;
  minFame: QueryField<number | undefined>;
  maxFame: QueryField<number | undefined>;
  castleCountMin: QueryField<number | undefined>;
  castleCountMax: QueryField<number | undefined>;
  orderBy: QueryField<string | undefined>;
  allianceFilter: QueryField<0 | 1 | undefined>;
  protectionFilter: QueryField<0 | 1 | undefined>;
  banFilter: QueryField<0 | 1 | undefined>;
  inactiveFilter: QueryField<0 | 1 | undefined>;
  playerNameForDistance: QueryField<string | undefined>;
  allianceRankFilter: QueryField<number[] | undefined>;
  orderType: QueryField<string | undefined>;
  alliance: QueryField<string | undefined>;
  castleType: QueryField<number | undefined>;
  movementType: QueryField<number | undefined>;
  searchType: QueryField<string | undefined>;
  search: QueryField<string | undefined>;
  allianceId: QueryField<number | undefined>;
  minMemberCount: QueryField<number | undefined>;
  maxMemberCount: QueryField<number | undefined>;
}

export const querySchema = (limits: {
  maxBigValue?: number;
  orderByValues?: string[];
  orderByDefault?: string;
}): QuerySchema => ({
  page: qNumber({ min: 1, max: limits.maxBigValue }),
  minHonor: qNumber({ max: limits.maxBigValue }),
  maxHonor: qNumber({ max: limits.maxBigValue }),
  minMight: qNumber({ max: limits.maxBigValue }),
  maxMight: qNumber({ max: limits.maxBigValue }),
  minLoot: qNumber({ max: limits.maxBigValue }),
  maxLoot: qNumber({ max: limits.maxBigValue }),
  minLevel: qLevelPair({ maxLevel: 70, maxLegendaryLevel: 950 }),
  maxLevel: qLevelPair({ maxLevel: 70, maxLegendaryLevel: 950 }),
  castleCountMin: qNumber({ max: limits.maxBigValue }),
  castleCountMax: qNumber({ max: limits.maxBigValue }),
  minFame: qNumber({ max: limits.maxBigValue }),
  maxFame: qNumber({ max: limits.maxBigValue }),
  orderBy: qOrderBy(limits.orderByValues, limits.orderByDefault),
  allianceFilter: qFlag(),
  alliance: qString({ max: 100 }),
  allianceId: qNumber({ max: limits.maxBigValue }),
  protectionFilter: qFlag(),
  banFilter: qFlag(),
  inactiveFilter: qFlag(),
  playerNameForDistance: qLowerString(),
  allianceRankFilter: qNumberArray(),
  orderType: qOrderType(),
  castleType: qNumber({ min: -1, max: 100 }),
  movementType: qNumber({ min: -1, max: 3 }),
  searchType: qSearchType(),
  minMemberCount: qNumber({ max: limits.maxBigValue }),
  maxMemberCount: qNumber({ max: limits.maxBigValue }),
  search: qString({ max: 40 }),
});

type InferSchema<T> = {
  [K in keyof T]: T[K] extends QueryField<infer R> ? R : never;
};

export const parseQuery = (query: Record<string, unknown>, schema: QuerySchema): InferSchema<QuerySchema> => {
  const result = {} as InferSchema<QuerySchema>;

  for (const key in schema) {
    result[key] = schema[key].parse(query[key]);
  }

  return result;
};
