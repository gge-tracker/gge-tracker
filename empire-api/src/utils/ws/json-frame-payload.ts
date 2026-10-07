export class JsonFramePayload {
  private parsed: unknown = null;
  private isParsed = false;

  constructor(
    public readonly command: string,
    public readonly id: string,
    public readonly status: number,
    public readonly body: string | null,
  ) {}

  public get carriesObject(): boolean {
    return this.body?.startsWith('{') ?? false;
  }

  public get data(): any {
    return this.isParsed ? this.parsed : this.parse();
  }

  public toJson(): string {
    if (!this.carriesObject) return JSON.stringify(this.body);
    if (!this.isParsed) this.parse();
    return this.body;
  }

  private parse(): unknown {
    this.parsed = this.carriesObject ? JSON.parse(this.body) : this.body;
    this.isParsed = true;
    return this.parsed;
  }
}
