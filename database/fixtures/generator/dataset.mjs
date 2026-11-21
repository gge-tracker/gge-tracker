import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CsvWriter } from './csv-writer.mjs';

export class Dataset {
  constructor(out, schemaDir, migrationsDir) {
    this.out = out;
    this.schemaDir = schemaDir;
    this.migrationsDir = migrationsDir;
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
  }

  postgres(database, table) {
    return new CsvWriter(join(this.out, 'postgres', database, `${table}.csv.gz`));
  }

  clickhouse(database, table) {
    return new CsvWriter(join(this.out, 'clickhouse', database, `${table}.csv.gz`));
  }

  shared(table) {
    return new CsvWriter(join(this.out, 'shared', `${table}.csv.gz`));
  }

  file(relativePath, content) {
    const path = join(this.out, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }

  postgresSchema(database, template) {
    for (const [part, file] of [['pre', '000-schema-pre.sql.gz'], ['post', '999-schema-post.sql.gz']]) {
      this.file(join('postgres', database, file), gzipSync(readFileSync(join(this.schemaDir, 'postgres', `${template}-${part}.sql`))));
    }
  }

  // The loader inserts the rows before it runs the migrations, so a table a migration creates must exist up front
  clickhouseSchema(database, template, templateDatabase, migrations = []) {
    let schema = readFileSync(join(this.schemaDir, 'clickhouse', `${template}.sql`), 'utf8')
      .replaceAll(`\`${templateDatabase}\``, `\`${database}\``)
      .replaceAll(` ${templateDatabase}.`, ` ${database}.`);
    for (const [file, table] of migrations) {
      const migration = readFileSync(join(this.migrationsDir, file), 'utf8');
      schema += '\n' + migration.replace(`CREATE TABLE IF NOT EXISTS ${table}`, `CREATE TABLE IF NOT EXISTS ${database}.${table}`);
    }
    this.file(join('clickhouse', database, '000-schema.sql.gz'), gzipSync(schema));
  }
}

export async function writeRows(writer, rows) {
  for (const row of rows) await writer.write(row);
  return writer.close();
}
