export type FilterKeyMap<FormFilters> = {
  [K in FilterField]: {
    min: keyof FormFilters;
    max: keyof FormFilters;
  };
};

export type FilterField = 'honor' | 'loot' | 'level' | 'might' | 'fame' | 'castleCount';
export type BoundType = 'min' | 'max';
