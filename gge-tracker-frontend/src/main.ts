/// <reference types="@angular/localize" />

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

void bootstrapApplication(AppComponent, appConfig).then(() => {
  document.querySelector('app-loader')?.remove();
  (document.querySelector('app-root') as HTMLElement)?.style.removeProperty('display');
});
