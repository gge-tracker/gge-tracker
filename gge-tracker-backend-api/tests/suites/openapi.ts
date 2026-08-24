/**
 * OpenAPI suite : does the published specification actually build, and does it describe the API
 */
import SwaggerParser from '@apidevtools/swagger-parser';
import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { buildOpenApiSpecification } from '../../src/documentation';
import { RegisteredRoute, UNDOCUMENTED_BY_DESIGN, discoverRoutes, mainSourcePath, routeKey } from '../lib/routes-source';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']);

/** `/players/:playerName` -> `/players/{playerName}` */
function toOpenApiPath(expressPath: string): string {
  return expressPath
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment))
    .join('/');
}

function pathParamNames(expressPath: string): string[] {
  return expressPath
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

interface Operation {
  path: string;
  method: string;
  operation: Record<string, any>;
}

function operationsOf(spec: Record<string, any>): Operation[] {
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item as Record<string, any>)) {
      if (HTTP_METHODS.has(method)) operations.push({ path, method: method.toUpperCase(), operation });
    }
  }
  return operations;
}

function declaredOperations(routes: RegisteredRoute[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const route of routes) {
    if (!route.documented) continue;
    const key = `${route.method} ${toOpenApiPath(route.path)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function declaresParam(operation: Record<string, any>, name: string, where: string): boolean {
  return (operation.parameters ?? []).some((p: any) => p?.name === name && p?.in === where);
}

function offendingPaths(report: string): string[] {
  const paths = new Set<string>();
  for (const [, path] of report.matchAll(/^\s{2}(\/\S*):\s*$/gm)) paths.add(path);
  return [...paths];
}

function firstYamlError(report: string): string {
  return report.split('\n').find((line) => /Error:/.test(line))?.trim() ?? report.split('\n')[1]?.trim() ?? '';
}

function checkBuild(section: Section): Record<string, any> | undefined {
  try {
    const spec = buildOpenApiSpecification([mainSourcePath()]);
    section.expect('specification builds from the @openapi blocks', {
      ok: true,
      detail: `${Object.keys(spec.paths ?? {}).length} paths`,
    });
    return spec;
  } catch (error: any) {
    // verbose embeds the offending YAML in the report, which is what makes this navigable
    const report = String(error?.message ?? error);
    const paths = offendingPaths(report);
    section.expect('specification builds from the @openapi blocks', {
      ok: false,
      detail: `${paths.length || 'some'} block(s) rejected${paths.length ? `: ${paths.join(', ')}` : ''} - ${firstYamlError(report)}`,
    });
    // The full report carries the snippet and line numbers, so print it rather than truncate it
    console.log(`\n  [31m@openapi blocks rejected by swagger-jsdoc[0m`);
    console.log(report.replace(/^/gm, '    '));
    console.log(
      `\n  [90mThese blocks are dropped from the published specification. "npx swagger-jsdoc" cannot`,
    );
    console.log(`  tell you this: its CLI calls process.exit() with no code, so it always exits 0.[0m\n`);
    return undefined;
  }
}

export async function runOpenApi(report: Report, _seeds: Seeds): Promise<void> {
  const section = report.section('openapi');

  const spec = checkBuild(section);
  if (!spec) return;
  let dereferenced: Record<string, any> | undefined;
  try {
    dereferenced = (await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)) as any)) as any;
    section.expect('specification is valid OpenAPI 3', { ok: true, detail: spec.openapi });
  } catch (error: any) {
    section.expect('specification is valid OpenAPI 3', {
      ok: false,
      detail: String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 600),
    });
  }

  const routes = discoverRoutes();
  const operations = operationsOf(spec);
  const declared = declaredOperations(routes);
  const duplicates = [...declared.entries()].filter(([, count]) => count > 1);
  section.expect('no @openapi block is overwritten by another', {
    ok: duplicates.length === 0,
    detail: duplicates.length
      ? duplicates.map(([key, count]) => `${key} declared ${count} times`).join('; ')
      : `${declared.size} operations declared`,
  });

  section.expect('every declared operation reached the specification', {
    ok: operations.length >= declared.size,
    detail: `${declared.size} declared in main.ts, ${operations.length} in the specification`,
  });

  const inSpec = new Set(operations.map((o) => `${o.method} ${o.path}`));
  for (const route of routes) {
    const key = routeKey(route);
    if (!route.documented) {
      if (!UNDOCUMENTED_BY_DESIGN.has(key)) {
        section.expect(`${key} is documented`, {
          ok: false,
          detail: `registered at main.ts:${route.line} with no @openapi block`,
        });
      }
      continue;
    }
    const specKey = `${route.method} ${toOpenApiPath(route.path)}`;
    section.expect(`${key} is in the specification`, {
      ok: inSpec.has(specKey),
      detail: inSpec.has(specKey)
        ? specKey
        : `documented at main.ts:${route.line} but "${specKey}" is not in the specification - the path in the block does not match the registered route`,
    });
  }

  const registered = new Set(
    routes.filter((r) => r.documented).map((r) => `${r.method} ${toOpenApiPath(r.path)}`),
  );
  const stale = [...inSpec].filter((key) => !registered.has(key));
  section.expect('no documented operation is unreachable', {
    ok: stale.length === 0,
    detail: stale.length ? `documented but no route serves them: ${stale.join(', ')}` : `${inSpec.size} operations`,
  });

  if (!dereferenced) return;
  for (const route of routes.filter((r) => r.documented)) {
    const expected = pathParamNames(route.path);
    if (expected.length === 0) continue;
    const operation = dereferenced.paths?.[toOpenApiPath(route.path)]?.[route.method.toLowerCase()];
    if (!operation) continue;
    const missing = expected.filter((name) => !declaresParam(operation, name, 'path'));
    section.expect(`${routeKey(route)} documents its path parameters`, {
      ok: missing.length === 0,
      detail: missing.length
        ? `route takes ${expected.join(', ')} but the block does not declare ${missing.join(', ')}`
        : expected.join(', '),
    });
  }
}
