import { AssetImageVariant } from './asset-image-renderer';

interface AssetSymbols {
  library: string;
  names: Set<string>;
  byLowerName: Map<string, string>;
}

export abstract class AssetSymbolResolver {
  private static readonly LIBRARY_PATTERN = /\b(\w+)\.(\w+)\|\|\(\1\.\2={}\)/;
  private static readonly SYMBOL_PATTERN = /\b\w+\.([A-Za-z]\w*)=(?!new\b)[$A-Z_a-z][\w$]*(?=[),;}])/g;
  private static readonly MAX_PARSED_SCRIPTS = 500;
  private static readonly parsed = new Map<string, AssetSymbols | null>();

  public static resolve(scriptKey: string, script: string, variant: AssetImageVariant): string | null {
    const symbols = this.symbolsOf(scriptKey, script);
    if (!symbols) return null;
    if (symbols.names.has(symbols.library)) return symbols.library;
    for (const candidate of this.variantNames(symbols.library, variant)) {
      if (symbols.names.has(candidate)) return candidate;
      const loose = symbols.byLowerName.get(candidate.toLowerCase());
      if (loose) return loose;
    }
    return null;
  }

  private static variantNames(library: string, variant: AssetImageVariant): string[] {
    // Mirrors the naming the game uses for wall, gate and tower levels
    const suffix = variant.level ? `Level${variant.level}` : '';
    const quality = variant.quality ? variant.quality.charAt(0).toUpperCase() + variant.quality.slice(1) : '';
    switch (variant.type) {
      case 'gate': {
        return [quality && `${quality}_Gate_${suffix}`, `Basic_Gate_${suffix}`].filter(Boolean);
      }
      case 'defence': {
        return [
          quality && `Castlewall_${quality}_Defence_${suffix}`,
          quality && `${quality}_Defence_${suffix}`,
          `Castlewall_Defence_${suffix}`,
          `Basic_Castlewall_${suffix}`,
        ].filter(Boolean);
      }
      case 'tower': {
        return [
          quality && `${quality}_Tower_${suffix}`,
          `Guard_Tower_${suffix}`,
          `Basic_Tower_Corner${suffix}_0`,
        ].filter(Boolean);
      }
      default: {
        if (!suffix) return [];
        const parts = library.split('_');
        const last = parts.pop();
        return [`${parts.join('_')}_${suffix}_${last}`];
      }
    }
  }

  private static symbolsOf(scriptKey: string, script: string): AssetSymbols | null {
    if (this.parsed.has(scriptKey)) return this.parsed.get(scriptKey)!;
    const library = this.LIBRARY_PATTERN.exec(script)?.[2];
    const symbols = library ? this.collectSymbols(library, script) : null;
    if (this.parsed.size >= this.MAX_PARSED_SCRIPTS) this.parsed.delete(this.parsed.keys().next().value!);
    this.parsed.set(scriptKey, symbols);
    return symbols;
  }

  private static collectSymbols(library: string, script: string): AssetSymbols {
    const names = new Set<string>();
    const byLowerName = new Map<string, string>();
    for (const match of script.matchAll(this.SYMBOL_PATTERN)) {
      const name = match[1];
      names.add(name);
      if (!byLowerName.has(name.toLowerCase())) byLowerName.set(name.toLowerCase(), name);
    }
    return { library, names, byLowerName };
  }
}
