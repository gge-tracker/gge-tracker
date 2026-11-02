import {
  ApiRelease,
  ApiReleaseChange,
  ApiReleaseChangeKind,
  ApiReleaseItem,
  ApiReleaseItemKind,
} from '@ggetracker-interfaces/empire-ranking';

export interface ReleaseGroup {
  kind: ReleaseKind;
  items: ApiReleaseItem[];
}

export interface ReleaseNote {
  version: string;
  type: string;
  date: string;
  groups: ReleaseGroup[];
  api: ApiChangeGroup[];
  summary: string;
}

export interface ApiChangeItem extends ApiReleaseChange {
  documentationUrl: string | null;
}

export interface ApiChangeGroup {
  kind: ApiReleaseChangeKind;
  label: string;
  items: ApiChangeItem[];
}

export interface ReleaseKind {
  id: ApiReleaseItemKind;
  label: string;
  unit: [string, string];
  icon: string;
}

const KINDS: Record<ApiReleaseItemKind, ReleaseKind> = {
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

const KIND_ORDER: ApiReleaseItemKind[] = ['new', 'improved', 'servers', 'translations', 'fixed'];

const API_DOCUMENTATION_URL = 'https://docs.gge-tracker.com';

const API_CHANGE_LABELS: Record<ApiReleaseChangeKind, string> = {
  new: 'New endpoints',
  changed: 'Changed',
  legacy: 'Legacy',
  removed: 'Removed',
};

const API_CHANGE_ORDER: ApiReleaseChangeKind[] = ['new', 'changed', 'legacy', 'removed'];

export function parseReleaseNote(release: ApiRelease): ReleaseNote {
  const groups = KIND_ORDER.map((id) => ({
    kind: KINDS[id],
    items: release.items.filter((item) => item.kind === id),
  })).filter((group) => group.items.length > 0);
  const api = groupApiChanges(release.api_changes);
  const counts = groups.map((group) => countLabel(group.items.length, group.kind.unit));
  if (release.api_changes.length > 0) {
    counts.push(countLabel(release.api_changes.length, ['API change', 'API changes']));
  }
  return {
    version: release.version,
    type: release.type,
    date: release.date,
    groups,
    api,
    summary: counts.join(' · '),
  };
}

function groupApiChanges(changes: ApiReleaseChange[]): ApiChangeGroup[] {
  return API_CHANGE_ORDER.map((kind) => ({
    kind,
    label: API_CHANGE_LABELS[kind],
    items: changes
      .filter((change) => change.change === kind)
      .map((change) => ({ ...change, documentationUrl: documentationUrl(change) })),
  })).filter((group) => group.items.length > 0);
}

function documentationUrl(change: ApiReleaseChange): string | null {
  if (change.change === 'removed') {
    return null;
  }
  const operation = `${change.method.toLowerCase()}${change.path.replaceAll(/\W/g, '_')}`;
  return `${API_DOCUMENTATION_URL}/#/${encodeURIComponent(change.tag)}/${operation}`;
}

function countLabel(count: number, [singular, plural]: [string, string]): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
