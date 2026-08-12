/**
 * Validates live 200 bodies against the response schemas the API publishes
 *
 * The openapi suite already proves the specification builds and that it describes every
 * registered route. It never checks that the API actually answers in the shape it
 * promises - so a renamed or dropped field ships green. This closes that gap by reusing
 * the same dereferenced specification against real responses.
 */
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildOpenApiSpecification } from '../../src/documentation';
import { mainSourcePath } from './routes-source';
import { Outcome } from './assert';
import { HttpResult } from './http';

let dereferenced: Record<string, any> | undefined | null;

/** Built once per run; null means the specification could not be loaded */
export async function specification(): Promise<Record<string, any> | null> {
  if (dereferenced !== undefined) return dereferenced;
  try {
    const spec = buildOpenApiSpecification([mainSourcePath()]);
    dereferenced = (await SwaggerParser.dereference(JSON.parse(JSON.stringify(spec)) as any)) as any;
  } catch {
    dereferenced = null;
  }
  return dereferenced;
}

/** `/players/Bob?page=1` against `/players/{playerName}` */
function pathMatches(specPath: string, actual: string): boolean {
  const pattern = specPath
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}')
        ? '[^/]+'
        : segment.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
    )
    .join('/');
  return new RegExp(`^${pattern}$`).test(actual);
}

function specificity(specPath: string): number {
  return specPath.split('/').filter((s) => s !== '' && !s.startsWith('{')).length;
}

export function responseSchemaFor(
  spec: Record<string, any>,
  method: string,
  path: string,
  status: number,
): Record<string, any> | undefined {
  const pathname = path.split('?')[0];
  const candidates = Object.keys(spec.paths ?? {})
    .filter((specPath) => pathMatches(specPath, pathname))
    .sort((a, b) => specificity(b) - specificity(a));
  for (const specPath of candidates) {
    const operation = spec.paths[specPath]?.[method.toLowerCase()];
    const response = operation?.responses?.[String(status)] ?? operation?.responses?.[status];
    const schema = response?.content?.['application/json']?.schema;
    if (schema) return schema;
  }
  return undefined;
}

interface Problem {
  where: string;
  message: string;
}

/**
 * A deliberately small structural validator
 *
 * It checks the things that break when a route is refactored - a declared property
 * disappearing, an object turning into an array, a number turning into an object - and
 * ignores formats, patterns and bounds, which would only produce noise against real data.
 */
function validate(value: unknown, schema: Record<string, any>, where: string, problems: Problem[]): void {
  if (!schema || problems.length >= 8) return;

  if (Array.isArray(schema.oneOf ?? schema.anyOf)) {
    const branches: Record<string, any>[] = schema.oneOf ?? schema.anyOf;
    const matched = branches.some((branch) => {
      const scoped: Problem[] = [];
      validate(value, branch, where, scoped);
      return scoped.length === 0;
    });
    if (!matched) problems.push({ where, message: `matches none of the ${branches.length} declared variants` });
    return;
  }

  const expected: string | undefined = schema.type;
  if (!expected) return;

  if (value === null) {
    // The specification is not consistently nullable, and null for "no alliance" is
    // normal in this domain, so a null is never treated as a shape break
    return;
  }

  const actual = Array.isArray(value) ? 'array' : typeof value;
  const compatible =
    expected === actual ||
    // JSON has one number type and the API returns bigints as strings
    (expected === 'integer' && actual === 'number') ||
    ((expected === 'number' || expected === 'integer') && actual === 'string' && Number.isFinite(Number(value))) ||
    (expected === 'string' && actual === 'number');

  if (!compatible) {
    problems.push({ where, message: `declared ${expected}, got ${actual}` });
    return;
  }

  if (expected === 'object' && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (!(name in record)) problems.push({ where: `${where}.${name}`, message: 'declared required, missing' });
    }
    for (const [name, child] of Object.entries<Record<string, any>>(schema.properties)) {
      if (name in record) validate(record[name], child, `${where}.${name}`, problems);
    }
  }

  if (expected === 'array' && schema.items) {
    // One element is enough to catch a shape change and keeps the output readable
    const items = value as unknown[];
    if (items.length > 0) validate(items[0], schema.items, `${where}[0]`, problems);
  }
}

function describe(schema: Record<string, any>, depth = 0): string {
  if (!schema) return 'anything';
  const branches: Record<string, any>[] | undefined = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(branches)) return branches.map((b) => describe(b, depth)).join(' | ');
  if (schema.type === 'array') return `${describe(schema.items ?? {}, depth + 1)}[]`;
  if (schema.type === 'object' && schema.properties) {
    if (depth >= 2) return 'object';
    const fields = Object.entries<Record<string, any>>(schema.properties).map(
      ([name, child]) => `${name}${(schema.required ?? []).includes(name) ? '' : '?'}: ${describe(child, depth + 1)}`,
    );
    return `{ ${fields.join(', ')} }`;
  }
  return schema.type ?? 'anything';
}

export function matchesSchema(res: HttpResult, schema: Record<string, any>): Outcome {
  const problems: Problem[] = [];
  validate(res.body, schema, 'body', problems);
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.map((p) => `${p.where} ${p.message}`).join('; ')
      : 'response matches the declared schema',
    expected: `a body matching the schema published for this route: ${describe(schema)}`,
    actual: problems.length
      ? problems.map((p) => `${p.where} ${p.message}`).join('; ')
      : 'every declared field is present with the declared type',
  };
}
