//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { AxiosError } from 'axios';

export interface ClickHouseCall {
  url: string;
  query: string;
  database: string;
  table: string | null;
  params: Record<string, string>;
  rows: Record<string, unknown>[];
  auth: { username: string; password: string } | undefined;
}

export class FakeClickHouse {
  public readonly calls: ClickHouseCall[] = [];

  private failures: (Error | null)[] = [];
  private readonly answers: { pattern: RegExp; rows: Record<string, unknown>[] }[] = [];

  constructor(private readonly baseUrl: string) {}

  public failWith(...outcomes: (Error | null)[]): this {
    this.failures = outcomes;
    return this;
  }

  public when(pattern: RegExp, rows: Record<string, unknown>[]): this {
    this.answers.push({ pattern, rows });
    return this;
  }

  public handles(url: string): boolean {
    return url.startsWith(this.baseUrl);
  }

  public post(url: string, payload: string, config: any): { status: number; data: string } {
    const parsed = new URL(url);
    const params = Object.fromEntries(parsed.searchParams.entries());
    const query = params.query ?? '';
    const insert = /INSERT INTO (\S+) FORMAT JSONEachRow/.exec(query);
    this.calls.push({
      url,
      query,
      database: params.database ?? '',
      table: insert ? insert[1] : null,
      params,
      rows: String(payload ?? '')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line)),
      auth: config?.auth,
    });
    const outcome = this.failures.shift();
    if (outcome) throw outcome;
    const answer = this.answers.find((candidate) => candidate.pattern.test(query));
    if (!answer) return { status: 200, data: '' };
    return { status: 200, data: answer.rows.map((row) => JSON.stringify(row)).join('\n') };
  }

  public selects(pattern: RegExp): ClickHouseCall[] {
    return this.calls.filter((call) => call.table === null && pattern.test(call.query));
  }

  public rows(table: string): Record<string, unknown>[] {
    return this.calls.filter((call) => call.table === table).flatMap((call) => call.rows);
  }

  public insertsInto(table: string): ClickHouseCall[] {
    return this.calls.filter((call) => call.table === table);
  }

  public get tables(): string[] {
    return [...new Set(this.calls.map((call) => call.table).filter((table): table is string => table !== null))];
  }
}

export function clickHouseError(status: number, code?: number): AxiosError {
  const error = new Error(code ? `Code: ${code}` : `HTTP ${status}`) as AxiosError;
  error.response = {
    status,
    statusText: '',
    headers: {},
    config: {} as any,
    data: code ? `Code: ${code}, e.displayText() = DB::Exception` : 'error',
  };
  return error;
}

export function networkError(message = 'ECONNRESET'): AxiosError {
  return new Error(message) as AxiosError;
}
