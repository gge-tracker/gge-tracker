import { NgFor, NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';

import package_ from '../../../../../package.json';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { TranslatePipe } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [NgTemplateOutlet, NgFor, TranslatePipe],
  templateUrl: './about.component.html',
  styleUrl: './about.component.css',
})
export class AboutComponent extends GenericComponent {
  public version = '';
  public shortVersion = '';
  public dateVersion = '';
  public safeTranslatedIntro1!: SafeHtml;
  public sanitizer = inject(DomSanitizer);
  private contribs = [
    { name: 'Ausone', server: 'FR1' },
    { name: 'Danadum', server: 'FR1' },
    { name: 'Kevin', server: 'NL1' },
    { name: 'Rubriq', server: 'FR1' },
    { name: 'Satana', server: 'RO1' },
    { name: 'Wojts8', server: 'PL1' },
    { name: 'Xenon', server: 'INT3' },
    { name: '0din0', server: 'IT1' },
    { name: 'Sekyra', server: 'CZ1' },
    { name: 'WillTheBoss', server: 'RO1' },
    { name: 'Aznoknis', server: 'LIVE' },
    { name: 'Fear', server: 'DE1' },
    { name: 'nitro0ogen', server: 'SA1' },
  ];

  constructor() {
    super();
    this.isInLoading = false;
    this.constructDateVersion(package_.version);
    this.constructVersion(package_.version);
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
