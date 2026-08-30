import { Injectable } from '@angular/core';
import { ApexLocale } from 'apexcharts';

const FIELD_SEPARATOR = '|';
const LABEL_SEPARATOR = ',';
const EXPORT_FORMAT_PLACEHOLDER = '%s';
const EXPORT_FORMATS = ['SVG', 'PNG', 'CSV'] as const;

const CHART_LOCALE_TEXTS: Record<string, string> = {
  fr: 'Janvier,Février,Mars,Avril,Mai,Juin,Juillet,Août,Septembre,Octobre,Novembre,Décembre|Jan,Fév,Mar,Avr,Mai,Juin,Juil,Août,Sep,Oct,Nov,Déc|Dimanche,Lundi,Mardi,Mercredi,Jeudi,Vendredi,Samedi|Dim,Lun,Mar,Mer,Jeu,Ven,Sam|Télécharger en %s|Menu,Sélection,Sélectionner une zone,Zoom avant,Zoom arrière,Déplacer,Réinitialiser le zoom',
  en: 'January,February,March,April,May,June,July,August,September,October,November,December|Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec|Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday|Sun,Mon,Tue,Wed,Thu,Fri,Sat|Download %s|Menu,Selection,Selection Zoom,Zoom In,Zoom Out,Panning,Reset Zoom',
  de: 'Januar,Februar,März,April,Mai,Juni,Juli,August,September,Oktober,November,Dezember|Jan,Feb,Mär,Apr,Mai,Jun,Jul,Aug,Sep,Okt,Nov,Dez|Sonntag,Montag,Dienstag,Mittwoch,Donnerstag,Freitag,Samstag|So,Mo,Di,Mi,Do,Fr,Sa|%s speichern|Menü,Auswahl,Auswahl vergrößern,Vergrößern,Verkleinern,Verschieben,Zoom zurücksetzen',
  nl: 'Januari,Februari,Maart,April,Mei,Juni,Juli,Augustus,September,Oktober,November,December|Jan,Feb,Maa,Apr,Mei,Jun,Jul,Aug,Sep,Okt,Nov,Dec|Zondag,Maandag,Dinsdag,Woensdag,Donderdag,Vrijdag,Zaterdag|Zo,Ma,Di,Wo,Do,Vr,Za|%s downloaden|Menu,Selectie,Inzoomen op selectie,Inzoomen,Uitzoomen,Verslepen,Zoom herstellen',
  ro: 'Ianuarie,Februarie,Martie,Aprilie,Mai,Iunie,Iulie,August,Septembrie,Octombrie,Noiembrie,Decembrie|Ian,Feb,Mar,Apr,Mai,Iun,Iul,Aug,Sep,Oct,Noi,Dec|Duminică,Luni,Marți,Miercuri,Joi,Vineri,Sâmbătă|Dum,Lun,Mar,Mie,Joi,Vin,Sâm|Descarcă %s|Meniu,Selecție,Zoom pe selecție,Mărire,Micșorare,Mutare,Resetează zoom-ul',
  pl: 'Styczeń,Luty,Marzec,Kwiecień,Maj,Czerwiec,Lipiec,Sierpień,Wrzesień,Październik,Listopad,Grudzień|Sty,Lu,Mar,Kwi,Maj,Cze,Lip,Sie,Wr,Paź,Lis,Gru|Niedziela,Poniedziałek,Wtorek,Środa,Czwartek,Piątek,Sobota|Nie,Pon,Wt,Śr,Cz,Pi,So|Pobierz %s|Menu,Wybór,Powiększ wybór,Powiększ,Pomniejsz,Przesuń,Resetuj powiększenie',
  ar: 'يناير,فبراير,مارس,أبريل,مايو,يونيو,يوليو,أغسطس,سبتمبر,أكتوبر,نوفمبر,ديسمبر|ينا,فبر,مار,أبر,ماي,يون,يول,أغس,سبت,أكت,نوف,ديس|الأحد,الاثنين,الثلاثاء,الأربعاء,الخميس,الجمعة,السبت|أحد,اثن,ثلا,أرب,خمي,جمع,سبت|تنزيل %s|القائمة,تحديد,تكبير التحديد,تكبير,تصغير,تحريك,إعادة تعيين التكبير',
};

function buildChartLocale([name, texts]: [string, string]): ApexLocale {
  const [months, shortMonths, days, shortDays, exportLabel, toolbarLabels] = texts.split(FIELD_SEPARATOR);
  const [menu, selection, selectionZoom, zoomIn, zoomOut, pan, reset] = toolbarLabels.split(LABEL_SEPARATOR);
  const [exportToSVG, exportToPNG, exportToCSV] = EXPORT_FORMATS.map((format) =>
    exportLabel.replace(EXPORT_FORMAT_PLACEHOLDER, format),
  );
  return {
    name,
    options: {
      months: months.split(LABEL_SEPARATOR),
      shortMonths: shortMonths.split(LABEL_SEPARATOR),
      days: days.split(LABEL_SEPARATOR),
      shortDays: shortDays.split(LABEL_SEPARATOR),
      toolbar: {
        exportToSVG,
        exportToPNG,
        exportToCSV,
        menu,
        selection,
        selectionZoom,
        zoomIn,
        zoomOut,
        pan,
        reset,
      },
    },
  };
}

@Injectable({
  providedIn: 'root',
})
export class RankingService {
  public isInLoading = true;

  public readonly CHART_LOCALES: ApexLocale[] = Object.entries(CHART_LOCALE_TEXTS).map(buildChartLocale);
}
