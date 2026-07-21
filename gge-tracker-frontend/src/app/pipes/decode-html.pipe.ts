import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'decodeHtml',
})
export class DecodeHtmlPipe implements PipeTransform {
  public transform(value: string | null | undefined): string {
    if (!value) return '';

    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;

    return textarea.value.replaceAll('&145;', '’');
  }
}
