//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import * as fs from 'node:fs';

export class Anonymiser {
  private static readonly PLAYER_ID_BASE = 900_000;
  private static readonly ALLIANCE_ID_BASE = 500_000;

  private readonly players = new Map<number, number>();
  private readonly alliances = new Map<number, number>();

  private constructor(private readonly file: string) {}

  public static load(file: string): Anonymiser {
    const anonymiser = new Anonymiser(file);
    if (!fs.existsSync(file)) return anonymiser;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [real, dummy] of Object.entries(saved.players ?? {})) {
      anonymiser.players.set(Number(real), Number(dummy));
    }
    for (const [real, dummy] of Object.entries(saved.alliances ?? {})) {
      anonymiser.alliances.set(Number(real), Number(dummy));
    }
    return anonymiser;
  }

  public save(): void {
    fs.writeFileSync(
      this.file,
      JSON.stringify(
        {
          note: 'Real -> dummy identifiers, kept so repeated captures stay consistent. No real names are stored.',
          players: Object.fromEntries(this.players),
          alliances: Object.fromEntries(this.alliances),
        },
        null,
        2,
      ) + '\n',
    );
  }

  public scrub<T>(value: T): T {
    return this.walk(value) as T;
  }

  private playerId(real: number): number {
    if (!this.players.has(real)) {
      this.players.set(real, Anonymiser.PLAYER_ID_BASE + this.players.size + 1);
    }
    return this.players.get(real)!;
  }

  private allianceId(real: number): number {
    if (real <= 0) return real;
    if (!this.alliances.has(real)) {
      this.alliances.set(real, Anonymiser.ALLIANCE_ID_BASE + this.alliances.size + 1);
    }
    return this.alliances.get(real)!;
  }

  private playerName(real: string, dummyId: number): string {
    const match = /^(.*)_([A-Za-z0-9]+)$/.exec(real);
    return match ? `Player_${dummyId}_${match[2]}` : `Player_${dummyId}`;
  }

  private walk(value: any): any {
    if (Array.isArray(value)) return value.map((entry) => this.walk(entry));
    if (value === null || typeof value !== 'object') return value;

    const result: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = this.walk(entry);
    }

    if (typeof result.OID === 'number') {
      const dummy = this.playerId(result.OID);
      result.OID = dummy;
      if (typeof result.N === 'string') result.N = this.playerName(result.N, dummy);
    }
    if (typeof result.PID === 'number') {
      const dummy = this.playerId(result.PID);
      result.PID = dummy;
      if (typeof result.NOM === 'string') result.NOM = this.playerName(result.NOM, dummy);
    }
    if (typeof result.AID === 'number') {
      const dummy = this.allianceId(result.AID);
      result.AID = dummy;
      if (typeof result.N === 'string' && typeof result.OID !== 'number') result.N = `Alliance_${dummy}`;
      if (typeof result.D === 'string') result.D = `Description of alliance ${dummy}`;
    }
    if (typeof result.AN === 'string') {
      result.AN = result.AN ? `Alliance_${result.AID ?? 'unknown'}` : result.AN;
    }
    return result;
  }
}
