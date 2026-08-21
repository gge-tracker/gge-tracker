import { AfterViewInit, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

const STARTUP_OVERLAY_FADE_MS = 400;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  imports: [RouterOutlet],
})
export class AppComponent implements AfterViewInit {
  public ngAfterViewInit(): void {
    const overlay: HTMLElement | null = document.querySelector('#startup-overlay');
    if (!overlay) return;
    requestAnimationFrame(() => {
      overlay.classList.add('startup-dismissed');
      setTimeout(() => overlay.remove(), STARTUP_OVERLAY_FADE_MS);
    });
  }
}
