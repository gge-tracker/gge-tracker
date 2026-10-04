import { AfterViewInit, Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';

const STARTUP_OVERLAY_FADE_MS = 400;
const BETA_BANNER_HIDDEN_KEY = 'beta-banner-hidden';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  imports: [RouterOutlet],
})
export class AppComponent implements AfterViewInit {
  private readonly localStorage = inject(LocalStorageService);

  public readonly betaBannerVisible = signal(this.localStorage.getItem(BETA_BANNER_HIDDEN_KEY) !== '1');

  public ngAfterViewInit(): void {
    const overlay: HTMLElement | null = document.querySelector('#startup-overlay');
    if (!overlay) return;
    requestAnimationFrame(() => {
      overlay.classList.add('startup-dismissed');
      setTimeout(() => overlay.remove(), STARTUP_OVERLAY_FADE_MS);
    });
  }

  public hideBetaBanner(): void {
    this.localStorage.setItem(BETA_BANNER_HIDDEN_KEY, '1');
    this.betaBannerVisible.set(false);
  }

  public showBetaBanner(): void {
    this.localStorage.removeItem(BETA_BANNER_HIDDEN_KEY);
    this.betaBannerVisible.set(true);
  }
}
