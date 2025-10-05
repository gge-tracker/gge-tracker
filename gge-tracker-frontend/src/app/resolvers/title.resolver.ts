import { inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ResolveFn } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import { LanguageService } from '@ggetracker-services/language.service';

export const titleResolver: ResolveFn<boolean> = async (route) => {
  inject(LanguageService);
  const translate = inject(TranslateService);
  const titleService = inject(Title);
  const meta = inject(Meta);
  const titleKey = route.data['titleKey'];
  const metaDescription = route.data['description'] || '';
  if (!titleKey) {
    return false;
  }
  const title = await translate.get('meta.' + titleKey).toPromise();
  titleService.setTitle(title);
  const descriptionTags: Record<string, string>[] = [
    {
      name: 'description',
    },
    {
      property: 'og:description',
    },
    {
      property: 'twitter:description',
    },
  ];
  if (metaDescription) {
    descriptionTags.forEach((tag) => {
      meta.updateTag({ ...tag, content: metaDescription });
    });
  }
  return true;
};
