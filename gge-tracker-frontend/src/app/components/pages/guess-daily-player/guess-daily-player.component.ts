import { DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { IconComponent } from '@ggetracker-components/icon/icon.component';

interface DailyTarget {
  id: string;
  game_date: string;
  server: string;
  player_id: number;
}

type GuessDirection = 'higher' | 'lower' | 'correct';

interface StatComparison<T> {
  guess: T;
  direction?: GuessDirection;
  status?: boolean;
}

interface GuessResult {
  win: boolean;
  distance: number;
  direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

  allianceRank: StatComparison<number | null>;
  level: StatComparison<number>;
  legendaryLevel: StatComparison<number | null>;
  honor: StatComparison<number>;
  might: StatComparison<number | string>;
  fame: StatComparison<number | string>;
  isProtection: {
    guess: boolean;
    status: boolean;
  };

  playerName: string;
}

@Component({
  selector: 'app-guess-daily-player',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, TranslatePipe, DecimalPipe, FormatNumberPipe, IconComponent],
  templateUrl: './guess-daily-player.component.html',
  styleUrls: ['./guess-daily-player.component.css'],
})
export class GuessDailyPlayerComponent extends GenericComponent implements OnInit {
  public dailyTarget: DailyTarget | null = null;
  public search: string = '';
  public guesses: GuessResult[] = [];
  public isWin: boolean = false;
  public Infinity: number = Infinity;
  public autoCompleteSuggestions: string[] = [];
  public isLose: boolean = false;
  public isSubmitting: boolean = false;
  public maxAttempts: number = 6;
  public todayGameDate: string | null = null;
  public directionEmojiMap: Record<GuessResult['direction'], string> = {
    N: '⬆️',
    NE: '↗️',
    E: '➡️',
    SE: '↘️',
    S: '⬇️',
    SW: '↙️',
    W: '⬅️',
    NW: '↖️',
  };
  public isInputFocused: boolean = false;
  private searchSubject = new Subject<string>();

  public async ngOnInit(): Promise<void> {
    try {
      this.searchSubject
        .pipe(
          debounceTime(400),
          distinctUntilChanged(),
          switchMap((value: string) =>
            this.apiRestService.apiFetch(
              ApiRestService.apiUrl + 'mini-games/guesses/autocomplete?query=' + encodeURIComponent(value),
            ),
          ),
        )
        .subscribe((response: any) => {
          if (response.success) {
            this.autoCompleteSuggestions = response.data as string[];
            this.isInputFocused = true;
          }
        });
      const dailyResponse = await this.apiRestService.apiFetch(ApiRestService.apiUrl + 'mini-games/daily');
      if (dailyResponse.success) {
        this.dailyTarget = dailyResponse.data as DailyTarget;
        this.todayGameDate = this.dailyTarget.game_date.split('T')[0];
        this.isInLoading = false;
      }
      const savedGuesses = localStorage.getItem('miniGameGuesses');
      if (savedGuesses) {
        const parsed = JSON.parse(savedGuesses) as { gameId: string; guesses: GuessResult[] };
        if (parsed.gameId === this.dailyTarget!.id) {
          this.guesses = parsed.guesses;
          if (this.guesses.some((g) => g.win)) {
            this.isWin = true;
          } else if (this.guesses.length >= this.maxAttempts) {
            this.isLose = true;
          }
        }
      }
      for (const key in localStorage) {
        if (key.startsWith('miniGameGuesses')) {
          const item = localStorage.getItem(key);
          if (item) {
            try {
              const parsed = JSON.parse(item) as { gameId: string; guesses: GuessResult[] };
              if (parsed.gameId !== this.dailyTarget!.id || parsed.guesses.length > this.maxAttempts) {
                localStorage.removeItem(key);
              }
            } catch {
              localStorage.removeItem(key);
            }
          }
        }
      }
    } catch {
      this.isInLoading = false;
    }
  }

  public get remainingTries(): number {
    return this.maxAttempts - this.guesses.length;
  }

  public async submitGuess(): Promise<void> {
    if (!this.search || this.isSubmitting || this.isWin || this.isLose) {
      return;
    }

    this.isSubmitting = true;

    const response = await this.apiRestService.apiFetch(ApiRestService.apiUrl + 'mini-games/guess', true, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'gge-server': this.apiRestService.serverService.currentServer!.name,
      },
      body: JSON.stringify({
        guess: this.search,
        requestGameId: Number(this.dailyTarget!.id),
      }),
    });

    if (response.success) {
      const result = response.data as GuessResult;
      this.guesses.unshift(result);
      localStorage.setItem('miniGameGuesses', JSON.stringify({ gameId: this.dailyTarget!.id, guesses: this.guesses }));

      if (result.win) {
        this.isWin = true;
      } else if (this.guesses.length >= this.maxAttempts) {
        this.isLose = true;
      }
    }

    this.search = '';
    this.isSubmitting = false;
  }

  public autoCompletePlayerNames(event: any): void {
    const value = event.target.value;
    if (value.length >= 2) {
      this.searchSubject.next(value);
    } else {
      this.autoCompleteSuggestions = [];
    }
  }

  public setUnlimitedTries(): void {
    this.maxAttempts = Infinity;
    this.maxAttempts = Infinity;
    this.isLose = false;
  }

  public getDirectionClass(direction: string): string {
    switch (direction) {
      case 'higher': {
        return 'up';
      }
      case 'lower': {
        return 'down';
      }
      case 'correct':
      case 'equal': {
        return 'match';
      }
      default: {
        return '';
      }
    }
  }

  public updateSearch(suggestion: string): void {
    this.search = suggestion;
    this.autoCompleteSuggestions = [];
    this.isInputFocused = false;
  }

  public updateInputFocusState(isFocused: boolean): void {
    this.isInputFocused = isFocused;
  }

  public getArrowIcon(direction: string): string {
    switch (direction) {
      case 'higher': {
        return 'fa-solid fa-arrow-up';
      }
      case 'lower': {
        return 'fa-solid fa-arrow-down';
      }
      case 'equal': {
        return 'fa-solid fa-check';
      }
      default: {
        return '';
      }
    }
  }

  public getCompassRotation(direction: string): number {
    const mapping: { [key: string]: number } = {
      N: 0,
      NE: 45,
      E: 90,
      SE: 135,
      S: 180,
      SW: 225,
      W: 270,
      NW: 315,
    };
    return mapping[direction] || 0;
  }

  public buildShareText(): string {
    const date = this.todayGameDate ?? '????-??-??';
    const attempts = this.guesses.length;
    const max = this.maxAttempts;

    const lines = [...this.guesses].reverse().map((g) => {
      const distribution = Math.round(g.distance);
      const stats = [
        this.comparisonEmoji(g.level.direction!),
        this.comparisonEmoji(g.legendaryLevel.direction!),
        this.comparisonEmoji(g.allianceRank.direction!),
        this.comparisonEmoji(g.honor.direction!),
        this.comparisonEmoji(g.might.direction!),
        this.comparisonEmoji(g.fame.direction!),
      ].join(' ');

      return `${stats} (${distribution}m)`;
    });

    return [
      `🗺️ GGE Daily Player #${date} (${this.dailyTarget?.server})`,
      ` Tries: ${this.isWin ? attempts : 'X'}/${max === Infinity ? '∞' : max}`,
      '',
      ...lines,
      '',
      this.isWin ? 'Found the player!' : 'Better luck tomorrow!',
      'https://gge-tracker.com/guess',
    ].join('\n');
  }

  public getArrow(direction?: GuessDirection): string {
    if (direction === 'higher') return '↑';
    if (direction === 'lower') return '↓';
    if (direction === 'correct') return '✓';
    return '';
  }

  public canGuess(): boolean {
    return !this.isWin && this.guesses.length < this.maxAttempts;
  }

  public async copyToClipboard(): Promise<void> {
    const text = this.buildShareText();
    await navigator.clipboard.writeText(text);
  }

  public getDirectionArrow(direction: string): string {
    const map: Record<string, string> = {
      N: '↑',
      NE: '↗',
      E: '→',
      SE: '↘',
      S: '↓',
      SW: '↙',
      W: '←',
      NW: '↖',
    };
    return map[direction] ?? '';
  }

  private comparisonEmoji(direction: 'correct' | 'higher' | 'lower'): string {
    if (direction === 'correct') return '🟩';
    if (direction === 'higher') return '🔼';
    return '🔽';
  }
}
