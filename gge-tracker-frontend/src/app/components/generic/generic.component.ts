import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, Renderer2, RendererFactory2 } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import { CastleType, CastleTypeDefaultTranslation } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LanguageService } from '@ggetracker-services/language.service';
import { RankingService } from '@ggetracker-services/ranking.service';
import { ToastService } from '@ggetracker-services/toast.service';
import { UtilitiesService } from '@ggetracker-services/utilities.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-generic',
  standalone: true,
  imports: [],
  templateUrl: './generic.component.html',
  styleUrl: './generic.component.css',
})
export class GenericComponent {
  public isBrowser = false;
  public platformId = inject(PLATFORM_ID);
  public apiRestService = inject(ApiRestService);
  public toastService = inject(ToastService);
  public utilitiesService = inject(UtilitiesService);
  public rankingService = inject(RankingService);
  public route = inject(ActivatedRoute);
  public langageService = inject(LanguageService);
  public router = inject(Router);
  public meta = inject(Meta);
  public translateService = inject(TranslateService);

  private renderer = inject(Renderer2);
  private rendererFactory = inject(RendererFactory2);

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.renderer = this.rendererFactory.createRenderer(null, null);
  }

  public async updatePageInUrl(page: number): Promise<void> {
    await this.updateGenericParamsInUrl({ page: page }, { page: 1 });
  }

  public async updateGenericParamsInUrl(
    parameters: { [key: string]: any },
    defaultParameters: { [key: string]: any },
  ): Promise<void> {
    const queryParameters: { [key: string]: any } = {};
    for (const key in parameters) {
      if (parameters[key] === defaultParameters[key]) {
        queryParameters[key] = null;
      } else {
        queryParameters[key] = parameters[key];
      }
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: queryParameters,
      queryParamsHandling: 'merge',
    });
  }

  public getOpacityForPeaceTime(peaceDisabledAt: string | null): number {
    if (!peaceDisabledAt) return 1;
    // Calculate the time difference in seconds
    const timeInSeconds = Math.abs(Date.now() - new Date(peaceDisabledAt).getTime()) / 1000;
    if (timeInSeconds < 60 * 60 * 12) return 0.2;
    if (timeInSeconds < 60 * 60 * 24) return 0.4;
    if (timeInSeconds < 60 * 60 * 24 * 7) return 0.6;
    if (timeInSeconds < 60 * 60 * 24 * 7 * 2) return 0.8;
    else return 1;
  }

  public isPeaceDisabledBefore63days(peaceDisabledAt: string): boolean {
    if (!peaceDisabledAt) return false;
    const peaceDisabledDate = new Date(peaceDisabledAt);
    const currentDate = new Date();
    const diffTime = Math.abs(currentDate.getTime() - peaceDisabledDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays < 63;
  }

  public getRemeaningPeaceTime(timeInSeconds: number, fromDate: string): Date {
    const date = new Date(fromDate);
    date.setSeconds(date.getSeconds() + timeInSeconds);
    return date;
  }

  public async getTranslations(translations: string[]): Promise<string[]> {
    try {
      const values = [];
      for (const translation of translations) {
        values.push(await firstValueFrom(this.translateService.get(translation)));
      }
      return values;
    } catch (error) {
      console.error('Error fetching translations:', error);
      return [];
    }
  }

  /**
   * This function returns the type of castle based on the type number.
   * It is used to display the type of castle in the UI.
   * This method must return the i18n key for the type of castle (by default in French).
   * @param type The type of castle as a number.
   * @returns The castle name as a key for i18n.
   */
  public getCastleType(type: number): string {
    switch (type) {
      case CastleType.CASTLE: {
        return CastleTypeDefaultTranslation.CASTLE;
      }
      case CastleType.REALM_CASTLE: {
        return CastleTypeDefaultTranslation.CASTLE;
      }
      case CastleType.OUTPOST: {
        return CastleTypeDefaultTranslation.OUTPOST;
      }
      case CastleType.MONUMENT: {
        return CastleTypeDefaultTranslation.MONUMENT;
      }
      case CastleType.LABORATORY: {
        return CastleTypeDefaultTranslation.LABORATORY;
      }
      case CastleType.CAPITAL: {
        return CastleTypeDefaultTranslation.CAPITAL;
      }
      case CastleType.ROYAL_TOWER: {
        return CastleTypeDefaultTranslation.ROYAL_TOWER;
      }
      case CastleType.CITY: {
        return CastleTypeDefaultTranslation.CITY;
      }
      default: {
        return CastleTypeDefaultTranslation.UNKNOWN;
      }
    }
  }

  public getDescription(
    movementType: number,
    positionOld: (number | null)[],
    positionNew: (number | null)[],
  ): { description: string; image: string; keyword: string } {
    const titleType = this.getCastleType(movementType);
    const needE =
      movementType === CastleType.CAPITAL || movementType === CastleType.CITY || movementType === CastleType.ROYAL_TOWER
        ? 'e'
        : '';
    if (movementType === 1 && positionOld[0] && positionOld[1] && positionNew[0] && positionNew[1]) {
      return {
        image: `<img src="/assets/moving.png">`,
        keyword: CastleTypeDefaultTranslation.MOVEMENT,
        description: `(${positionOld[0]}, ${positionOld[1]}) -> (${positionNew[0]}, ${positionNew[1]})`,
      };
    } else if (
      movementType === 1 &&
      positionOld[0] &&
      positionOld[1] &&
      positionNew[0] === null &&
      positionNew[1] === null
    ) {
      return {
        image: `<img src="/assets/ruins.png">`,
        keyword: `${titleType} ${CastleTypeDefaultTranslation.DELETED}`,
        description: `(${positionOld[0]}, ${positionOld[1]})`,
      };
    } else if (
      movementType === 1 &&
      positionOld[0] === null &&
      positionOld[1] === null &&
      positionNew[0] &&
      positionNew[1]
    ) {
      return {
        image: `<img src="/assets/new-castle.png">`,
        keyword: CastleTypeDefaultTranslation.NEW_PLAYER,
        description: `(${positionNew[0]}, ${positionNew[1]})`,
      };
    } else {
      if (positionOld[0] && positionOld[1] && positionNew[0] === null && positionNew[1] === null) {
        return {
          image: `<img src="/assets/ruins.png">`,
          keyword: `${titleType} ${CastleTypeDefaultTranslation.ABANDONED}${needE}`,
          description: `(${positionOld[0]}, ${positionOld[1]})`,
        };
      } else if (positionOld[0] === null && positionOld[1] === null && positionNew[0] && positionNew[1]) {
        return {
          image: `<img src="/assets/new-castle.png">`,
          keyword: `${CastleTypeDefaultTranslation.CONQUEST}${needE} ${titleType.toLowerCase()}`,
          description: `(${positionNew[0]}, ${positionNew[1]})`,
        };
      }
    }
    return {
      image: ``,
      keyword: '',
      description: ``,
    };
  }

  public addStructuredAlliancesData(
    alliances: {
      name: string;
      url: string;
      nbMembers: number;
      members?: {
        name: string;
        url: string;
        might: number;
        level: string;
      }[];
      might: number;
    }[],
  ): void {
    if (this.isBrowser && alliances.length > 0) {
      this.clearStructuredData();
      const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: alliances.map((alliance, index) => ({
          '@type': 'Organization',
          position: index + 1,
          name: alliance.name,
          url: alliance.url,
          member: alliance.members
            ? alliance.members.map((member) => ({
                '@type': 'Person',
                name: member.name,
                url: member.url,
                additionalProperty: [
                  {
                    '@type': 'PropertyValue',
                    name: 'Might',
                    value: member.might,
                  },
                  {
                    '@type': 'PropertyValue',
                    name: 'Level',
                    value: member.level,
                  },
                ],
              }))
            : [],
          additionalProperty: [
            {
              '@type': 'PropertyValue',
              name: 'Number of Members',
              value: alliance.nbMembers,
            },
            {
              '@type': 'PropertyValue',
              name: 'Might',
              value: alliance.might,
            },
          ],
        })),
      };
      const script = this.renderer.createElement('script');
      script.type = 'application/ld+json';
      script.text = JSON.stringify(structuredData, null, 2);
      this.renderer.appendChild(document.head, script);
    }
  }

  public addStructuredPlayersData(
    players: {
      name: string;
      url: string;
      alliance: string;
      might: number;
      level: string;
    }[],
  ): void {
    if (this.isBrowser && players.length > 0) {
      this.clearStructuredData();
      const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: players.map((player, index) => ({
          '@type': 'Person',
          position: index + 1,
          name: player.name,
          url: player.url,
          ...(player.alliance && {
            affiliation: {
              '@type': 'Organization',
              name: player.alliance,
            },
          }),
          additionalProperty: [
            {
              '@type': 'PropertyValue',
              name: 'Might',
              value: player.might,
            },
            {
              '@type': 'PropertyValue',
              name: 'Level',
              value: player.level,
            },
          ],
        })),
      };

      const script = this.renderer.createElement('script');
      script.type = 'application/ld+json';
      script.text = JSON.stringify(structuredData, null, 2);
      this.renderer.appendChild(document.head, script);
    }
  }

  public addStructuredPlayerData(player: { name: string; url: string; alliance: string; might: number }): void {
    if (this.isBrowser) {
      this.clearStructuredData();
      const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: player.name,
        url: player.url,
        ...(player.alliance && {
          affiliation: {
            '@type': 'Organization',
            name: player.alliance,
          },
        }),
        additionalProperty: [
          {
            '@type': 'PropertyValue',
            name: 'Might',
            value: player.might,
          },
        ],
      };

      const script = this.renderer.createElement('script');
      script.type = 'application/ld+json';
      script.text = JSON.stringify(structuredData, null, 2);
      this.renderer.appendChild(document.head, script);
    }
  }

  private clearStructuredData(): void {
    const existingScripts = document.querySelectorAll('script[type="application/ld+json"]');
    existingScripts.forEach((script) => {
      if (script.parentNode) {
        script.remove();
      }
    });
  }

  public get isInLoading(): boolean {
    return this.rankingService.isInLoading;
  }

  public set isInLoading(value: boolean) {
    this.rankingService.isInLoading = value;
  }

  public get currentLang(): string {
    return this.langageService.currentLang;
  }
}
