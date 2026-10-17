import { Component, inject, OnDestroy } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { LayeredSceneComponent } from '@ggetracker-components/layered-scene/layered-scene.component';
import { RankingService } from '@ggetracker-services/ranking.service';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslatePipe, LayeredSceneComponent],
  templateUrl: './not-found.component.html',
  styleUrl: './not-found.component.css',
  standalone: true,
})
export class NotFoundComponent implements OnDestroy {
  private readonly meta = inject(Meta);
  private readonly rankingService = inject(RankingService);

  constructor() {
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    queueMicrotask(() => (this.rankingService.isInLoading = false));
  }

  public ngOnDestroy(): void {
    this.meta.removeTag('name="robots"');
  }
}
