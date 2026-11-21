import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';

const NEEDS_QUOTES = /[",\n\r]/;

export function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text === '') return '""';
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class CsvWriter {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.gzip = createGzip({ level: 6 });
    this.done = once(this.gzip.pipe(createWriteStream(file)), 'finish');
    this.rows = 0;
    this.pending = [];
  }

  async write(fields) {
    this.rows++;
    this.pending.push(fields.map(csvField).join(','));
    if (this.pending.length >= 5000) await this.flush();
  }

  async flush() {
    if (this.pending.length === 0) return;
    const chunk = this.pending.join('\n') + '\n';
    this.pending = [];
    if (!this.gzip.write(chunk)) await once(this.gzip, 'drain');
  }

  async close() {
    await this.flush();
    this.gzip.end();
    await this.done;
    return this.rows;
  }
}

export const sqlTimestamp = (instant) => new Date(instant).toISOString().replace('T', ' ').replace('Z', '');
export const sqlTimestampTz = (instant) => `${sqlTimestamp(instant)}+00`;
export const clickHouseDateTime = (instant) => new Date(instant).toISOString().slice(0, 19).replace('T', ' ');
