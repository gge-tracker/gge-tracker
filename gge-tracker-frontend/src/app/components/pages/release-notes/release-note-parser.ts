export interface ReleaseItem {
  area: string;
  text: string;
}

export interface ReleaseGroup {
  kind: ReleaseKind;
  items: ReleaseItem[];
}

export interface ReleaseNote {
  version: string;
  type: string;
  date: string;
  groups: ReleaseGroup[];
  summary: string;
}

export interface ReleaseKind {
  id: string;
  label: string;
  unit: [string, string];
  icon: string;
}

const KINDS: Record<string, ReleaseKind> = {
  new: { id: 'new', label: 'New', unit: ['new', 'new'], icon: 'fa-solid fa-plus' },
  improved: { id: 'improved', label: 'Improved', unit: ['improved', 'improved'], icon: 'fa-solid fa-arrow-trend-up' },
  servers: { id: 'servers', label: 'Servers', unit: ['server', 'servers'], icon: 'fa-solid fa-server' },
  translations: {
    id: 'translations',
    label: 'Translations',
    unit: ['translation', 'translations'],
    icon: 'fa-solid fa-language',
  },
  fixed: { id: 'fixed', label: 'Fixed', unit: ['fixed', 'fixed'], icon: 'fa-solid fa-bug' },
};

const KIND_ORDER = ['new', 'improved', 'servers', 'translations', 'fixed'];

const KIND_BY_EMOJI: Record<string, string> = {
  '🛠️': 'new',
  '✨': 'improved',
  '🎨': 'improved',
  '⚙️': 'improved',
  '📦': 'servers',
  '🌍': 'translations',
  '🐞': 'fixed',
};

const ITEM_PATTERN = /^(\S+)\s+\[([^\]]+)\]\s+(.*)$/u;

export function parseReleaseNote(release: {
  version: string;
  type: string;
  date: string;
  items: string[];
}): ReleaseNote {
  const byKind = new Map<string, ReleaseItem[]>();
  for (const raw of release.items) {
    const match = ITEM_PATTERN.exec(raw);
    const kind = (match && KIND_BY_EMOJI[match[1]]) ?? 'improved';
    const item = match ? { area: match[2] === 'Bugfix' ? '' : match[2], text: match[3] } : { area: '', text: raw };
    byKind.set(kind, [...(byKind.get(kind) ?? []), item]);
  }
  const groups = KIND_ORDER.filter((id) => byKind.has(id)).map((id) => ({ kind: KINDS[id], items: byKind.get(id)! }));
  return {
    version: release.version,
    type: release.type,
    date: release.date,
    groups,
    summary: groups.map((group) => countLabel(group.items.length, group.kind.unit)).join(' · '),
  };
}

function countLabel(count: number, [singular, plural]: [string, string]): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
