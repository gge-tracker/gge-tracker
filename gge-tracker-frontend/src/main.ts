/// <reference types="@angular/localize" />

import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppRoutingModule } from './app/app.module';

void platformBrowserDynamic()
  .bootstrapModule(AppRoutingModule)
  .then(() => {
    document.querySelector('app-loader')?.remove();
    (document.querySelector('app-root') as HTMLElement)?.style.removeProperty('display');
  });
