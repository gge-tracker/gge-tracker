import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

export enum EnumTypeReleaseNote {
  MAJOR = 'Major',
  MINOR = 'Minor',
  FIX = 'Fix',
}

@Component({
    selector: 'app-release-notes',
    imports: [CommonModule],
    templateUrl: './release-notes.component.html',
    styleUrl: './release-notes.component.css'
})
export class ReleaseNotesComponent {
  public readonly releaseNotes = [
    {
      version: 'v26-02-15',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2026-02-15',
      items: [
        '📦 [Server] Added new servers: E4K-RU1, E4K-WORLD2, EP-ES2, EP-AE1',
        '📦 [Server] Added EP-BG1, PARTNER_SP3, EP-AU1, E4K-RU1, EP-US1 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
        '🛠️ [Tools] Added movement filtering and alliance filtering',
        '🛠️ [Tools] Added export button (xlsx) for player, alliance, and movement lists',
        "✨ [Player Analysis] Added new 'Glory' tab with detailed glory statistics (current title, estimated loss, points needed for next title, etc.)",
        '✨ [Miscellaneous] Replaced circular ranking chart with raw points table on alliance event statistics page',
        '✨ [Miscellaneous] Added PWA support (Progressive Web App)',
        '✨ [Miscellaneous] Restored Danadum "Empire Rankings" link in the sidebar',
        '🛠️ [Mini-Game] Added daily mini-game "Who is it" (find a mystery player using distance, direction, and clue-based guesses)',
        '🐞 [Bugfix] Fixed UTC issues affecting hourly activity rate and alliance/player loot charts',
        '🐞 [Bugfix] Fixed "Distance (m)" column displayed in incorrect position',
        '🐞 [Bugfix] Fixed player sorting in alliance tab',
        '🐞 [Bugfix] Fixed sidebar overlapping certain charts',
        '🐞 [API] Cartography endpoint no longer returns inactive players',
      ],
    },
    {
      version: 'v26-01-05',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2026-01-05',
      items: [
        '📦 [Server] Added new servers: EP-SK1, E4K-CN1, E4K-GB1, EP-BG1, EP-JP1, EP-WORLD2, PARTNER-SP3',
        '📦 [Server] Added E4K-HANT, E4K-CN1, EP-BR1, EP-GR1, EP-ES1, EP-HU1, EP-INT3 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
        '🐞 [Bugfix] Fixed an issue where the SKN1 flag was not displaying correctly',
        '✨ [Miscellaneous] Added advanced weekly player points analytics (hourly activity rate, average gain and weekly activity map) to the player analysis tool',
        "✨ [Miscellaneous] Added player's alliance rank",
        '✨ [Miscellaneous] Improved player filtering with glory points range, castle count range, alliance rank selection, and advanced sorting options',
      ],
    },
    {
      version: 'v25-12-08',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2025-12-08',
      items: [
        '🛠️ [Tools] Added new tool: real-time EP Outer Realms leaderboard with rankings, scores, and minute-by-minute ranking changes (event-type dependent)',
        '🎨 [Design] Complete UI overhaul of the entire website',
        '🐞 [Bugfix] Fixed numerous issues and improved overall stability',
        '📦 [Server] Added new EP servers: ASIA, EG1, GB1, SKN1',
        '📦 [Server] Added EP-TR1 and E4K-BR1 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
      ],
    },
    {
      version: 'v25-11-02',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2025-11-02',
      items: [
        '⚙️ [Server] Added Empire Four Kingdoms (E4K) system implementation',
        '📦 [Server] Added new servers: EP-GR1, E4K-BR1, E4K-DE1, E4K-DE2, E4K-FR1, E4K-HANT1, E4K-INT2, E4K-US1',
        '📦 [Server] Added EP-NL1 server to realtime fortress tracker tool',
        '🛠️ [Tools] Added new tool (EP): Grand Tournament alliances analysis with hour by hour points tracking and global leaderboard',
        '✨ [Miscellaneous] Added search functionality for servers list',
        '✨ [Miscellaneous] Added GitHub repository link in the navigation bar',
        '✨ [Miscellaneous] Added Discord member count display in the navigation bar',
        '🐞 [Bugfix] Fixed custom alliance colors in the cartography tab not being reset after adding a server',
        '🐞 [Bugfix] Fixed issue with translations were incorrectly applied in the cartography filtering mechanism',
      ],
    },
    {
      version: 'v25-10-12',
      type: EnumTypeReleaseNote.MINOR,
      date: '2025-10-12',
      items: [
        '📦 [Server] Added new servers: INT1, RU1, CN1',
        '📦 [Server] Added DE1 server to realtime fortress tracker tool',
      ],
    },
    {
      version: 'v25-09-14',
      type: EnumTypeReleaseNote.MINOR,
      date: '2025-09-14',
      items: [
        '⚙️ [Server] Technical improvements and optimizations',
        '✨ [Miscellaneous] Official Discord support server added: https://discord.gg/eb6WSHQqYh',
      ],
    },
    {
      version: 'v25-09-01',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2025-09-01',
      items: [
        '📦 [Server] Added new servers: ES1, SA1',
        '🛠️ [Tools] Added new tool: Realtime castle visualizer (Tools - Castles)',
        '🛠️ [Tools] Added SA1 server to fortress tracker',
        '🎨 [Design] General design overhaul of the application',
      ],
    },
    {
      version: 'v25-08-11',
      type: EnumTypeReleaseNote.MINOR,
      date: '2025-08-11',
      items: [
        '✨ [Miscellaneous] Added search history for player and alliance searches',
        '🐞 [Bugfix] Fixed issue with the Polish translation not being applied correctly',
        '🐞 [Bugfix] Fixed an issue where the cartography tool was not displaying correctly',
      ],
    },
    {
      version: 'v25-08-06',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2025-08-06',
      items: [
        '📦 [Server] Added new servers: HU1, HU2',
        '🎨 [Design] General design overhaul of the application',
        '🐞 [Bugfix] Fixed issue with the Romanian translation not being applied correctly',
        '🌍 [Translation] New translation available: Deutsch (German)',
        '🛠️ [Tools] Added new indicators on player analysis page (server ranking, global ranking, number of castles, etc.)',
        "🛠️ [Tools] Added external link to 'empire-rankings' in Tools section",
      ],
    },
    {
      version: 'v25-07-19',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2025-07-19',
      items: [
        '🎨 [Design] General design overhaul of the application',
        '🛠️ [Tools] Added new tool: Event Tracker (for Outer Realms & Beyond the Horizon)',
        "🛠️ [Tools] Revamped Cartography tool: improved performance, new features (add or remove an alliance, change an alliance's color in the legend, etc.)",
      ],
    },
    {
      version: 'v25-07-07',
      type: EnumTypeReleaseNote.MAJOR,
      date: '2025-07-07',
      items: [
        '📦 [Server] Added new server: HANT1',
        '🐞 [Bugfix] Fixed realtime fortress tracker tool for CZ1, RO1, FR1 and IT1',
      ],
    },
  ];
}
