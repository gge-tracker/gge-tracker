import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-stats-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats-panel.component.html',
  styleUrl: './stats-panel.component.css',
})
export class StatsPanelComponent {
  public title = input.required<string>();
  public subtitle = input<string>();
  public accent = input<string>('#495057');
  public bannerImage = input<string>();
  public texture = input<string>('/assets/textures/little-triangles.png');

  public get headLayer(): string {
    const banner = this.bannerImage();
    return banner ? `url(${banner})` : `url(${this.texture()}), ${this.accent()}`;
  }

  public get hasBanner(): boolean {
    return !!this.bannerImage();
  }
}
