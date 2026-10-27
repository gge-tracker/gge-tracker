import { Injectable } from '@angular/core';
import { ApexLocale } from 'apexcharts';
import apexAr from 'apexcharts/dist/locales/ar.json';
import apexBg from 'apexcharts/dist/locales/bg.json';
import apexCs from 'apexcharts/dist/locales/cs.json';
import apexDe from 'apexcharts/dist/locales/de.json';
import apexEl from 'apexcharts/dist/locales/el.json';
import apexEn from 'apexcharts/dist/locales/en.json';
import apexEs from 'apexcharts/dist/locales/es.json';
import apexFr from 'apexcharts/dist/locales/fr.json';
import apexHu from 'apexcharts/dist/locales/hu.json';
import apexIt from 'apexcharts/dist/locales/it.json';
import apexNl from 'apexcharts/dist/locales/nl.json';
import apexPl from 'apexcharts/dist/locales/pl.json';
import apexPt from 'apexcharts/dist/locales/pt-br.json';
import apexRo from 'apexcharts/dist/locales/ro.json';
import apexRu from 'apexcharts/dist/locales/ru.json';
import apexTr from 'apexcharts/dist/locales/tr.json';

const CHART_LOCALES_BY_LANG: Record<string, ApexLocale> = {
  ar: apexAr,
  bg: apexBg,
  cs: apexCs,
  de: apexDe,
  el: apexEl,
  en: apexEn,
  es: apexEs,
  fr: apexFr,
  hu: apexHu,
  it: apexIt,
  nl: apexNl,
  pl: apexPl,
  pt: apexPt,
  ro: apexRo,
  ru: apexRu,
  tr: apexTr,
};

const CHART_LOCALES: ApexLocale[] = Object.entries(CHART_LOCALES_BY_LANG).map(([name, locale]) => ({
  ...locale,
  name,
}));

@Injectable({
  providedIn: 'root',
})
export class RankingService {
  public isInLoading = true;

  public readonly CHART_LOCALES = CHART_LOCALES;
}
