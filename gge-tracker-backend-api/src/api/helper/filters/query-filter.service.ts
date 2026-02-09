export class QueryFilterService {
  public parameterIndex = 1;

  public getNextParameterIndex(): number {
    return this.parameterIndex++;
  }

  public resetParameterIndex(): void {
    this.parameterIndex = 1;
  }

  public setParameterIndex(index: number): void {
    this.parameterIndex = index;
  }
}
