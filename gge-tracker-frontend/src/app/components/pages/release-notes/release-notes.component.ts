import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { RankingService } from '@ggetracker-services/ranking.service';

import { parseReleaseNote, ReleaseNote } from './release-note-parser';

@Component({
  selector: 'app-release-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  standalone: true,
  templateUrl: './release-notes.component.html',
  styleUrl: './release-notes.component.css',
})
export class ReleaseNotesComponent {
  public readonly releases = signal<ReleaseNote[]>([]);
  public readonly failed = signal(false);

  private readonly apiRestService = inject(ApiRestService);
  private readonly rankingService = inject(RankingService);

  constructor() {
    void this.loadReleases();
  }

  private async loadReleases(): Promise<void> {
    const response = await this.apiRestService.getReleaseNotes();
    if (response.success) {
      this.releases.set(response.data.releases.map((release) => parseReleaseNote(release)));
    } else {
      this.failed.set(true);
    }
    this.rankingService.isInLoading = false;
  }
}
