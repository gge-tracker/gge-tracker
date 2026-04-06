import { AfterViewInit, Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements AfterViewInit {
  public ngAfterViewInit(): void {
    const overlay: HTMLElement | null = document.querySelector('#startup-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.remove();
    }
  }
}
