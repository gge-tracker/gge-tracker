import { inject, Injectable } from '@angular/core';
import { ApiRestService } from '@ggetracker-services/api-rest.service';

export interface LocatedRealmCastle {
  playerId: string;
  playerName: string;
  x: number;
  y: number;
}

interface RealmCastle extends LocatedRealmCastle {
  kingdomId: number;
}

const REALM_CASTLE_TYPE = 12;

@Injectable({ providedIn: 'root' })
export class RealmCastleLocatorService {
  private readonly apiRestService = inject(ApiRestService);
  private readonly cache = new Map<string, RealmCastle[]>();

  public async locate(playerName: string, kingdomId: number): Promise<LocatedRealmCastle | null> {
    const castles = await this.realmCastlesOf(playerName.trim());
    return castles.find((castle) => castle.kingdomId === kingdomId) ?? null;
  }

  private async realmCastlesOf(playerName: string): Promise<RealmCastle[]> {
    const key = playerName.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const suggestions = await this.apiRestService.getPlayerSuggestions(playerName);
    if (!suggestions.success) return [];
    const player = suggestions.data.suggestions.find((suggestion) => suggestion.name.toLowerCase() === key);
    if (!player) return [];
    const profile = await this.apiRestService.getPlayerProfile(player.id, 'castles');
    if (!profile.success) return [];
    const castles = (profile.data.castles ?? [])
      .filter((castle) => castle.castle_type === REALM_CASTLE_TYPE)
      .map((castle) => ({
        playerId: player.id,
        playerName: player.name,
        x: castle.position_x,
        y: castle.position_y,
        kingdomId: castle.kingdom_id,
      }));
    this.cache.set(key, castles);
    return castles;
  }
}
