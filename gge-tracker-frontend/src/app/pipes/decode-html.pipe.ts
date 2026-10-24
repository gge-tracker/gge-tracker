import { Pipe, PipeTransform } from '@angular/core';

const MAX_CODE_POINT = 1_114_111;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

@Pipe({
  name: 'decodeHtml',
})
export class DecodeHtmlPipe implements PipeTransform {
  public transform(value: string | null | undefined): string {
    if (!value) return '';
    return this.decode(value).replaceAll('&145;', '’');
  }

  private decode(value: string): string {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = value;
      return textarea.value;
    }
    return value.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith('#')) {
        const point = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
        return point > 0 && point <= MAX_CODE_POINT ? String.fromCodePoint(point) : entity;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    });
  }
}
