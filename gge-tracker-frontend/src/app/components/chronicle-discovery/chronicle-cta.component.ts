import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CHRONICLE_PROMOTED_YEAR, ChronicleDiscoveryService } from '@ggetracker-services/chronicle-discovery.service';
import { TranslateModule } from '@ngx-translate/core';

export const CHRONICLE_ANCHOR_SELECTOR = '[data-chronicle-anchor]';

@Component({
  selector: 'app-chronicle-cta',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  templateUrl: './chronicle-cta.component.html',
  styleUrl: './chronicle-cta.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChronicleCtaComponent {
  public readonly playerId = input.required<string>();
  public readonly variant = input<'hero' | 'dock' | 'pill'>('hero');

  public readonly discovery = inject(ChronicleDiscoveryService);
  public readonly year = CHRONICLE_PROMOTED_YEAR;
}
