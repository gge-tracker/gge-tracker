import { NgFor, NgTemplateOutlet } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { TranslatePipe } from '@ngx-translate/core';
import package_ from '../../../../../package.json';
import { environment } from 'environments/environment';

export interface Contributor {
  name: string;
  server: string;
}

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [NgTemplateOutlet, NgFor, TranslatePipe],
  templateUrl: './about.component.html',
  styleUrl: './about.component.css',
})
export class AboutComponent extends GenericComponent implements OnInit {
  public version = '';
  public shortVersion = '';
  public dateVersion = '';
  public safeTranslatedIntro1!: SafeHtml;
  public sanitizer = inject(DomSanitizer);
  private contribs: { name: string; server: string }[] = [];

  constructor() {
    super();
    this.isInLoading = false;
    this.constructDateVersion(package_.version);
    this.constructVersion(package_.version);
    const url = environment.i18nBaseUrl + 'contributors.xml';
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((xml) => {
        this.contribs = this.parseContributors(xml);
      })
      .catch((error) => {
        console.error('Failed to load contributors.xml', error);
      });
  }

  public ngOnInit(): void {
    this.translateService
      .get('about.intro-1', {
        heart: `<span style="color: #ff00009e;"><i class="fa-solid fa-heart"></i></span>`,
      })
      .subscribe((result: string) => {
        this.safeTranslatedIntro1 = this.sanitizer.bypassSecurityTrustHtml(result);
      });
  }

  private parseContributors(xml: string): Contributor[] {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const parserError = document.querySelector('parsererror');
    if (parserError) {
      console.error('XML parse error:', parserError.textContent);
      return [];
    }
    const nodes = [...(document.querySelectorAll('contributors > contributor') as unknown as Iterable<Element>)];
    return nodes.map((node) => {
      const name = node.querySelector('name')?.textContent?.trim() ?? 'Unknown';
      const server = node.querySelector('server')?.textContent?.trim() ?? 'Unknown';
      return { name, server };
    });
  }

  private constructDateVersion(version: string): void {
    const versionDate = version.split('-')[0];
    const year = '20' + versionDate.split('.')[0];
    const month = versionDate.split('.')[1];
    const day = versionDate.split('.')[2];
    this.dateVersion = new Date(
      Number.parseInt(year),
      Number.parseInt(month) - 1,
      Number.parseInt(day),
    ).toLocaleDateString();
  }

  private constructVersion(version: string): void {
    const split = version.split('-')[0];
    this.version = 'v' + split.split('.').slice(0, 2).join('.') + '.' + version.split('-')[1];
    this.shortVersion = 'v' + split;
  }

  public get orderedContribs(): { name: string; server: string }[] {
    return this.contribs.sort((a, b) => a.name.localeCompare(b.name));
  }
}
