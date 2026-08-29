import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslatePipe } from '@ngx-translate/core';
import package_ from '../../../../../package.json';
import { environment } from 'environments/environment';

export interface Contributor {
  name: string;
  server: string;
}

export interface ContributorLane {
  items: Contributor[];
  copies: number[];
  duration: number;
}

const LANE_SECONDS_PER_ITEM = 4.5;
const LANE_MIN_ITEMS = 16;

@Component({
  selector: 'app-about',
  imports: [NgTemplateOutlet, TranslatePipe],
  templateUrl: './about.component.html',
  standalone: true,
  styleUrl: './about.component.css',
})
export class AboutComponent extends GenericComponent implements OnInit {
  public version = '';
  public shortVersion = '';
  public dateVersion = '';
  public currentYear = new Date().getFullYear();
  public safeTranslatedIntro1!: SafeHtml;
  public sanitizer = inject(DomSanitizer);
  public contribs: Contributor[] = [];
  public lanes: ContributorLane[] = [];
  public rollPaused = false;
  private readonly serverService = inject(ServerService);

  constructor() {
    super();
    this.isInLoading = false;
    this.constructDateVersion(package_.version);
    this.constructVersion(package_.version);
  }

  public async fetchContributors(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      this.contribs = this.parseContributors(xml).sort((a, b) => a.name.localeCompare(b.name));
      this.lanes = this.buildLanes(this.contribs);
    } catch (error) {
      console.error('Failed to load contributors.xml', error);
    }
  }

  public ngOnInit(): void {
    void this.fetchContributors(environment.i18nBaseUrl + 'contributors.xml');
    this.translateService
      .get('about.intro-1', {
        heart: `<span style="color: #ff00009e;"><i class="fa-solid fa-heart"></i></span>`,
      })
      .subscribe((result: string) => {
        this.safeTranslatedIntro1 = this.sanitizer.bypassSecurityTrustHtml(result);
      });
  }

  public flagUrl(server: string): string {
    return this.serverService.getFlagUrl(server);
  }

  public initial(contrib: Contributor): string {
    return contrib.name.charAt(0).toUpperCase();
  }

  public toggleRoll(): void {
    this.rollPaused = !this.rollPaused;
  }

  private buildLanes(contribs: Contributor[]): ContributorLane[] {
    if (contribs.length === 0) return [];
    const lanes: Contributor[][] =
      contribs.length > 6
        ? [contribs.filter((_, index) => index % 2 === 0), contribs.filter((_, index) => index % 2 === 1)]
        : [contribs];
    return lanes
      .filter((items) => items.length > 0)
      .map((items) => {
        const copies = Math.max(2, Math.ceil(LANE_MIN_ITEMS / items.length));
        return {
          items,
          copies: Array.from({ length: copies }, (_, index) => index),
          duration: Math.round(items.length * LANE_SECONDS_PER_ITEM),
        };
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
}
