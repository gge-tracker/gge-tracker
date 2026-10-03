import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

export interface MePlayer {
  playerId: string;
  playerName: string;
  server: string;
}

export interface SubjectSnapshot {
  might: number;
  loot?: number;
  honor?: number;
  rank?: number | null;
  members?: number;
}

export interface VisitSnapshot {
  at: string;
  players: Record<string, SubjectSnapshot>;
  alliances: Record<string, SubjectSnapshot>;
}

interface VisitHistory {
  previous: VisitSnapshot | null;
  current: VisitSnapshot | null;
}

const FOLLOWED_PLAYERS_KEY = 'favories';
const FOLLOWED_ALLIANCES_KEY = 'followed-alliances';
const ME_KEY = 'me';
const VISITS_KEY = 'dashboard-visits';
const VISIT_GAP_MS = 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class FollowService {
  public readonly me = signal<MePlayer | null>(null);
  public readonly followedPlayers = signal<string[]>([]);
  public readonly followedAlliances = signal<string[]>([]);

  private readonly localStorage = inject(LocalStorageService);

  constructor() {
    this.me.set(this.read<MePlayer | null>(ME_KEY, null, (value) => this.isMe(value)));
    this.followedPlayers.set(this.readIds(FOLLOWED_PLAYERS_KEY));
    this.followedAlliances.set(this.readIds(FOLLOWED_ALLIANCES_KEY));
  }

  public setMe(me: MePlayer): void {
    this.me.set(me);
    this.localStorage.setItem(ME_KEY, JSON.stringify(me));
  }

  public clearMe(): void {
    this.me.set(null);
    this.localStorage.removeItem(ME_KEY);
  }

  public isMe(value: unknown): value is MePlayer {
    const candidate = value as MePlayer | null;
    return (
      typeof candidate?.playerId === 'string' &&
      typeof candidate.playerName === 'string' &&
      typeof candidate.server === 'string'
    );
  }

  public isFollowingPlayer(id: string | number): boolean {
    return this.followedPlayers().includes(String(id));
  }

  public isFollowingAlliance(id: string | number): boolean {
    return this.followedAlliances().includes(String(id));
  }

  public togglePlayer(id: string | number): void {
    this.toggle(FOLLOWED_PLAYERS_KEY, this.followedPlayers, String(id));
  }

  public toggleAlliance(id: string | number): void {
    this.toggle(FOLLOWED_ALLIANCES_KEY, this.followedAlliances, String(id));
  }

  public recordVisit(snapshot: Omit<VisitSnapshot, 'at'>): VisitSnapshot | null {
    const history = this.read<VisitHistory>(VISITS_KEY, { previous: null, current: null }, (value) =>
      this.isHistory(value),
    );
    const now = new Date();
    const fresh: VisitSnapshot = { at: now.toISOString(), ...snapshot };
    const current = history.current;
    const startsNewVisit = !current || now.getTime() - new Date(current.at).getTime() > VISIT_GAP_MS;
    const next: VisitHistory = startsNewVisit
      ? { previous: current, current: fresh }
      : { previous: history.previous, current: { ...fresh, at: current.at } };
    this.localStorage.setItem(VISITS_KEY, JSON.stringify(next));
    return next.previous;
  }

  private toggle(key: string, state: WritableSignal<string[]>, id: string): void {
    const ids = state();
    const next = ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
    state.set(next);
    this.localStorage.setItem(key, JSON.stringify(next));
  }

  private readIds(key: string): string[] {
    return [...new Set(this.read<unknown[]>(key, [], Array.isArray).map(String))];
  }

  private isHistory(value: unknown): value is VisitHistory {
    return typeof value === 'object' && value !== null && 'previous' in value && 'current' in value;
  }

  private read<T>(key: string, fallback: T, valid: (value: unknown) => boolean): T {
    try {
      const raw = this.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return valid(parsed) ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  }
}
