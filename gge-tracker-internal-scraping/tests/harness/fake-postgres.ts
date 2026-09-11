//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//

export interface RecordedQuery {
  text: string;
  sql: string;
  params: any[];
  database: string;
}

export interface QueryRule {
  match: RegExp;
  rows?: any[];
  rowCount?: number;
  error?: Error & { code?: string };
  onCall?: number;
}

export function collapse(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export class FakePostgres {
  public readonly queries: RecordedQuery[] = [];
  public readonly pools: FakePostgresPool[] = [];
  public readonly clients: FakePostgresStandaloneClient[] = [];
  public readonly endedDatabases: string[] = [];

  private readonly rules: QueryRule[] = [];
  private readonly defaults: QueryRule[] = [];
  private readonly matchCounts = new Map<QueryRule, number>();

  public when(match: RegExp, result: Omit<QueryRule, 'match'> = {}): this {
    this.rules.push({ match, ...result });
    return this;
  }

  public whenDefault(match: RegExp, result: Omit<QueryRule, 'match'> = {}): this {
    this.defaults.push({ match, ...result });
    return this;
  }

  public createPool(config: Record<string, any>): FakePostgresPool {
    const pool = new FakePostgresPool(this, String(config?.database ?? 'default'), Number(config?.max ?? 10));
    this.pools.push(pool);
    return pool;
  }

  public createClient(config: Record<string, any>): FakePostgresStandaloneClient {
    const client = new FakePostgresStandaloneClient(this, String(config?.database ?? 'default'));
    this.clients.push(client);
    return client;
  }

  public matching(pattern: RegExp): RecordedQuery[] {
    return this.queries.filter((query) => pattern.test(query.sql));
  }

  public one(pattern: RegExp): RecordedQuery {
    const found = this.matching(pattern);
    if (found.length !== 1) {
      throw new Error(`Expected exactly one statement matching ${pattern}, found ${found.length}`);
    }
    return found[0];
  }

  public run(text: string, params: any[], database: string): { rows: any[]; rowCount: number } {
    const sql = collapse(text);
    this.queries.push({ text, sql, params: params ?? [], database });
    for (const rule of [...this.rules, ...this.defaults]) {
      if (!rule.match.test(sql)) continue;
      const seen = this.matchCounts.get(rule) ?? 0;
      this.matchCounts.set(rule, seen + 1);
      if (rule.onCall !== undefined && rule.onCall !== seen) continue;
      if (rule.error) throw rule.error;
      const rows = rule.rows ?? [];
      return { rows, rowCount: rule.rowCount ?? rows.length };
    }
    return { rows: [], rowCount: 0 };
  }
}

export class FakePostgresPool {
  public ended = false;
  public checkedOut = 0;

  constructor(
    private readonly parent: FakePostgres,
    public readonly database: string,
    public readonly max: number = 10,
  ) {}

  public async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    this.takeClient();
    try {
      return this.run(text, params);
    } finally {
      this.checkedOut--;
    }
  }

  public async connect(): Promise<FakePostgresClient> {
    this.takeClient();
    return new FakePostgresClient(this);
  }

  public run(text: string, params: any[] = []): { rows: any[]; rowCount: number } {
    return this.parent.run(text, params, this.database);
  }

  // pg-pool answers this way when every client is checked out and connectionTimeoutMillis expires
  private takeClient(): void {
    if (this.checkedOut >= this.max) throw new Error('timeout exceeded when trying to connect');
    this.checkedOut++;
  }

  public on(): this {
    return this;
  }

  public async end(): Promise<void> {
    this.ended = true;
    this.parent.endedDatabases.push(this.database);
  }
}

export class FakePostgresClient {
  public released = false;

  constructor(private readonly pool: FakePostgresPool) {}

  public async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    return this.pool.run(text, params);
  }

  public release(): void {
    this.released = true;
    this.pool.checkedOut--;
  }
}

export class FakePostgresStandaloneClient {
  public connected = false;
  public ended = false;

  constructor(
    private readonly parent: FakePostgres,
    public readonly database: string,
  ) {}

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    return this.parent.run(text, params, this.database);
  }

  public on(): this {
    return this;
  }

  public async end(): Promise<void> {
    this.ended = true;
  }
}

export function pgError(code: string, message = `postgres error ${code}`): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
