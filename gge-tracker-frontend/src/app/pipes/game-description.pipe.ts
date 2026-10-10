import { Pipe, PipeTransform } from '@angular/core';
import { DecodeHtmlPipe } from './decode-html.pipe';

@Pipe({
  name: 'gameDescription',
})
export class GameDescriptionPipe implements PipeTransform {
  private static readonly ESCAPED_LINE_BREAK = /&lt;br\s*\/?&gt;/gi;
  private readonly decoder = new DecodeHtmlPipe();

  public static toSafeHtml(text: string): string {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll(GameDescriptionPipe.ESCAPED_LINE_BREAK, '<br>');
  }

  public transform(value: string | null | undefined): string {
    return GameDescriptionPipe.toSafeHtml(this.decoder.transform(value));
  }
}
