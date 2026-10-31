import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-brand-wordmark',
  standalone: true,
  template: 'GGE Tracker',
  styleUrl: './brand-wordmark.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandWordmarkComponent {}
