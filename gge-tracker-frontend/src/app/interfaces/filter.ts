export type FilterKeyMap<FormFilters, T extends string | number | symbol> = {
  [K in T]: {
    min: keyof FormFilters;
    max: keyof FormFilters;
  };
};

export type BoundType = 'min' | 'max';
