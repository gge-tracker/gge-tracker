import * as fs from 'node:fs';
import * as path from 'node:path';

function composeValue(raw: string): string {
  const quoted = /^(["'])(.*)\1\s*$/.exec(raw);
  if (quoted) return quoted[2];
  return raw.replace(/\s+#.*$/, '').trim();
}

export function fromDotEnv(name: string): string | undefined {
  for (const candidate of [path.resolve(__dirname, '..', '..', '.env'), path.resolve(__dirname, '..', '..', '..', '.env')]) {
    let source: string;
    try {
      source = fs.readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
    const line = source.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
    if (line === undefined) continue;
    const value = composeValue(line.slice(name.length + 1));
    if (value !== '') return value;
  }
  return undefined;
}
