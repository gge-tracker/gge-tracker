// The body is only parsed when something reads it, and sent back over HTTP as the game wrote it
export class JsonFramePayload {
  private parsed: unknown = null;
  private parseDone = false;

  constructor(
    public readonly command: string,
    public readonly id: string,
    public readonly status: number,
    public readonly body: string | null,
  ) {}

  public get isParsed(): boolean {
    return this.parseDone;
  }

  public get carriesObject(): boolean {
    return this.body?.startsWith('{') ?? false;
  }

  public get data(): any {
    return this.parseDone ? this.parsed : this.parse();
  }

  public toJson(): string {
    if (!this.carriesObject) return JSON.stringify(this.body);
    if (!this.parseDone) this.parse();
    return this.body;
  }

  private parse(): unknown {
    this.parsed = this.carriesObject ? JSON.parse(this.body) : this.body;
    this.parseDone = true;
    return this.parsed;
  }
}
