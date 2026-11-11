import { inject, Pipe, PipeTransform } from '@angular/core';

import { LanguageService } from '@ggetracker-services/language.service';
import { punctuate } from '@ggetracker-services/text-format.utilities';

@Pipe({
  name: 'punctuation',
  standalone: true,
})
export class PunctuationPipe implements PipeTransform {
  private readonly languageService = inject(LanguageService);

  public transform(text: string, mark: ':' | '!'): string {
    return punctuate(text, mark, this.languageService.getCurrentLang());
  }
}
