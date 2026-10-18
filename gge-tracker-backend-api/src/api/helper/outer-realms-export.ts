import { OuterRealmsPlayer } from './cache/outer-realms-board';

export type OuterRealmsExportFormat = 'json' | 'ndjson' | 'csv';

interface ExportColumn {
  header: string;
  value: (player: OuterRealmsPlayer) => string | number | null | undefined;
}

export abstract class OuterRealmsExport {
  public static readonly FORMATS: OuterRealmsExportFormat[] = ['json', 'ndjson', 'csv'];

  public static readonly CONTENT_TYPES: Record<OuterRealmsExportFormat, string> = {
    json: 'application/json; charset=utf-8',
    ndjson: 'application/x-ndjson; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
  };

  private static readonly CSV_COLUMNS: ExportColumn[] = [
    { header: 'rank', value: (player) => player.rank },
    { header: 'player_id', value: (player) => player.player_id },
    { header: 'player_name', value: (player) => player.player_name },
    { header: 'server', value: (player) => player.server },
    { header: 'score', value: (player) => player.score },
    { header: 'score_diff', value: (player) => player.score_diff },
    { header: 'rank_diff', value: (player) => player.rank_diff },
    { header: 'level', value: (player) => player.level },
    { header: 'legendary_level', value: (player) => player.legendary_level },
    { header: 'might', value: (player) => player.might },
    { header: 'castle_x', value: (player) => player.castle_position[0] },
    { header: 'castle_y', value: (player) => player.castle_position[1] },
  ];

  private static readonly DISTANCE_COLUMN: ExportColumn = { header: 'distance', value: (player) => player.distance };

  public static fileName(collectedAt: Date, format: OuterRealmsExportFormat): string {
    const stamp = collectedAt.toISOString().slice(0, 16).replaceAll(/[:-]/g, '').replace('T', '-');
    return `outer-realms-${stamp}.${format}`;
  }

  public static toNdjson(players: OuterRealmsPlayer[]): string {
    return players.map((player) => JSON.stringify(player) + '\n').join('');
  }

  public static toCsv(players: OuterRealmsPlayer[], withDistance: boolean): string {
    const columns = withDistance ? [...this.CSV_COLUMNS, this.DISTANCE_COLUMN] : this.CSV_COLUMNS;
    const lines = [columns.map((column) => column.header).join(',')];
    for (const player of players) {
      lines.push(columns.map((column) => this.csvCell(column.value(player))).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  private static csvCell(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    // A leading formula character makes spreadsheets evaluate a player name
    const safe = /^[\t\r+=@\-]/.test(value) ? `'${value}` : value;
    return /[\n\r",]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }
}
