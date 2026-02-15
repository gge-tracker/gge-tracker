type CacheKeyPart = string | number | boolean | null | undefined;

export class CacheKeyBuilder {
  private readonly parts: string[] = [];

  constructor(base: string) {
    this.parts.push(base);
  }

  public with(value: CacheKeyPart): this {
    if (value !== undefined && value !== null) {
      this.parts.push(String(value));
    }
    return this;
  }

  public withParams(parameters: Record<string, CacheKeyPart>): this {
    Object.entries(parameters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        this.parts.push(`${key}-${value}`);
      }
    });
    return this;
  }

  public build(): string {
    return this.parts.join(':');
  }
}
