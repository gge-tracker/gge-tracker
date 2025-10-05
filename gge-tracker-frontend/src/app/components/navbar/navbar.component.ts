import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  Blocks,
  Castle,
  ExternalLink,
  Globe,
  Info,
  LucideAngularModule,
  Map,
  Swords,
  TableProperties,
  User,
  Users,
} from 'lucide-angular';

import pkg from '../../../../package.json';
import { LanguageService } from '@ggetracker-services/language.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { ServerService } from '@ggetracker-services/server.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterModule, NgClass, TranslateModule, LucideAngularModule, NgFor, FormsModule, NgIf],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css',
})
export class NavbarComponent {
  public serverService = inject(ServerService);
  public languageService = inject(LanguageService);
  public currentLangText = this.languageService.getCurrentLang();
  public version = '';
  public readonly Globe = Globe;
  public readonly Info = Info;
  public readonly Map = Map;
  public readonly Castle = Castle;
  public readonly Swords = Swords;
  public readonly Blocks = Blocks;
  public readonly ExternalLink = ExternalLink;
  public readonly TableProperties = TableProperties;
  public readonly User = User;
  public readonly Users = Users;
  private localStorage = inject(LocalStorageService);
  private router = inject(Router);
  private _isDevLanguage: boolean = this.localStorage.getItem('lang_dev') !== null || false;

  constructor() {
    this.version = 'v' + pkg.version.split('-')[0];
  }

  public resetTranslationMode(): void {
    this.localStorage.removeItem('lang_dev');
    window.location.reload();
  }

  public isActive(route: string | string[]): boolean {
    if (Array.isArray(route)) {
      return route.some((r) => this.router.url.startsWith('/' + r) || this.router.url.startsWith(r));
    }
    return this.router.url.startsWith('/' + route) || this.router.url.startsWith(route);
  }

  public changeLanguage(): void {
    this.languageService.setCurrentLang(this.currentLangText);
    this.localStorage.setItem('lang', this.currentLangText);
  }

  public get isDevLanguage(): boolean {
    return this._isDevLanguage;
  }
}
