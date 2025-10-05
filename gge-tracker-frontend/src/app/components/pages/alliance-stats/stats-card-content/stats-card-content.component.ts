import { NgIf } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { ApiPlayerStatsType } from '@ggetracker-interfaces/empire-ranking';

@Component({
  selector: 'app-stats-card-content',
  standalone: true,
  imports: [NgIf, FormsModule, TranslateModule],
  templateUrl: './stats-card-content.component.html',
  styleUrl: './stats-card-content.component.css',
})
export class StatsCardContentComponent {
  public previousGraphOutput = output<ApiPlayerStatsType>();
  public nextGraphOutput = output<ApiPlayerStatsType>();
  public toggleSeriesLabelsOutput = output<keyof typeof ApiPlayerStatsType>();
  public cumulSeriesLabelsOutput = output<keyof typeof ApiPlayerStatsType>();
  public openFullscreen = output<keyof typeof ApiPlayerStatsType>();
  public closeFullscreen = output<void>();
  public statsType = input.required<ApiPlayerStatsType>();
  public keyStatsType = input.required<keyof typeof ApiPlayerStatsType>();
  public fullScreenModalKey = input.required<string | null>();
  public seriesLabels = input.required<Record<keyof typeof ApiPlayerStatsType, boolean>>();
  public cumulSeries = input.required<Record<keyof typeof ApiPlayerStatsType, boolean>>();
  public currentTab = input.required<string | null>();

  public previousGraph(): void {
    this.previousGraphOutput.emit(this.statsType());
  }

  public nextGraph(): void {
    this.nextGraphOutput.emit(this.statsType());
  }

  public toggleSeriesLabels(): void {
    this.toggleSeriesLabelsOutput.emit(this.keyStatsType());
  }

  public cumulSeriesLabels(): void {
    this.cumulSeriesLabelsOutput.emit(this.keyStatsType());
  }
}
