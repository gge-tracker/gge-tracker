// Keys another service writes or reads, or that describe what both backends share (the assets volume, the store proxy budget)
const SHARED_KEY_PREFIXES = [
  'fill-version:',
  'dungeon-version:',
  'storm-version:',
  'global-ranking:version',
  'grand-tournament:event-dates:version',
  'rift-raid:event-dates:version',
  'temporaryServerData',
  'outerRealms',
  'temp-server-settings',
  'offers:',
  'gge_build_version',
  'ItemsVersion',
];

const KEYED_COMMANDS = new Set([
  'get',
  'set',
  'setEx',
  'del',
  'exists',
  'expire',
  'ttl',
  'incr',
  'hGet',
  'hSet',
  'hmGet',
  'hGetAll',
  'sAdd',
  'sMembers',
]);

export function isSharedKey(key: string): boolean {
  return SHARED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function namespacedKey(key: string, namespace: string): string {
  return isSharedKey(key) ? key : `${namespace}:${key}`;
}

export function withCacheNamespace<T extends object>(client: T, namespace: string | undefined): T {
  if (!namespace) return client;
  const rename = (key: unknown): unknown => {
    if (typeof key === 'string') return namespacedKey(key, namespace);
    if (Array.isArray(key)) return key.map((entry) => rename(entry));
    return key;
  };
  return new Proxy(client, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (!KEYED_COMMANDS.has(String(property))) return value.bind(target);
      return (...parameters: unknown[]) => {
        const keyIndex = typeof parameters[0] === 'object' && !Array.isArray(parameters[0]) ? 1 : 0;
        parameters[keyIndex] = rename(parameters[keyIndex]);
        return value.apply(target, parameters);
      };
    },
  });
}
