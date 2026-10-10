import { NgClass, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { ModalTableColumn, ModalTableComponent } from '@ggetracker-components/modal-table/modal-table.component';
import {
  ApiCartoAlliance,
  ApiCartoMap,
  ApiResponse,
  Castle,
  CastleQuantity,
  CastleType,
  ErrorType,
  Monument,
  WatchModeStats,
  WorldSizeDimensions,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ServerService } from '@ggetracker-services/server.service';
import { WindowService } from '@ggetracker-services/window.service';
import { TranslateModule } from '@ngx-translate/core';
import type * as Leaflet from 'leaflet';
import { combineLatest } from 'rxjs';

interface ILegend {
  name: string;
  color: string;
  detail: string;
}

interface PowerTier {
  minMight: number;
  radius: number;
  players: number;
  labelZoomOffset: number | null;
}

interface CastleMarker {
  marker: L.CircleMarker;
  baseRadius: number;
}

interface BuildingMarker {
  polygon: L.Polygon;
  x: number;
  y: number;
  basePx: number;
}

interface HeatmapCell {
  pp: number;
  players: string[];
  playerCount: number;
}

const MAP_GRID_STEP = 100;
const MAP_TOP_PADDING = 56;
const OUTPOST_RADIUS = 2.5;

// Share of the loaded players in each tier, strongest first
const POWER_TIER_SHARES = [0.05, 0.15, 0.3];
const POWER_TIER_RADII = [9, 6, 4, 2.5];
const POWER_TIER_LABEL_ZOOM = [0.75, 2, null, null];
const UNALLIED_KEY = '1';
const UNALLIED_COLOR = 'rgb(158, 158, 158)';
const LEGEND_PALETTE = [
  '#ff5252',
  '#448aff',
  '#ffd740',
  '#69f0ae',
  '#e040fb',
  '#ff9100',
  '#18ffff',
  '#f5f5f5',
  '#f48fb1',
  '#b388ff',
  '#00bfa5',
  '#ff8a80',
  '#8c9eff',
  '#c6a700',
  '#a1887f',
  '#d50000',
];
const DENSITY_STOPS: [number, number, number][] = [
  [59, 15, 112],
  [140, 41, 129],
  [222, 73, 104],
  [254, 159, 109],
  [252, 253, 191],
];

@Component({
  selector: 'app-server-cartography',
  imports: [
    NgClass,
    FormatNumberPipe,
    NgTemplateOutlet,
    FormsModule,
    TranslateModule,
    ModalTableComponent,
    ModalFormGroupComponent,
  ],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './server-cartography.component.html',
  styleUrl: './server-cartography.component.css',
})
export class ServerCartographyComponent extends GenericComponent implements AfterViewInit, OnDestroy {
  @ViewChild('heatmapCanvas', { static: true })
  public canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('mapStage', { static: true })
  public mapStageRef!: ElementRef<HTMLDivElement>;
  public map!: L.Map;
  public showUnallied = false;
  public isFullscreen = false;
  public cursorCoords: string | null = null;
  public maxIntensity = 0;
  public cellSize = 10;
  public resolution = 20;
  public downloadLoading = false;
  public heatmap: HeatmapCell[][] = [];
  public tooltipVisible = false;
  public tooltipX = 0;
  public tooltipY = 0;
  public tooltipData: { coords: string; pp: number; players: string[] } = {
    coords: '',
    pp: 0,
    players: [],
  };
  public watchModeAlliance: WatchModeStats = WatchModeStats.SPECIFIC_ALLIANCE;
  public selectedTab = 'strategic';
  public alliancesQuantity = 5;
  public loadedAlliancesQuantity = 5;
  public legends: ILegend[] = [];
  public castles: Castle[] = [];
  public nbPlayers = 0;
  public monumentsList: Monument[] = [];
  public selectedWorld: number | undefined = undefined;
  public formFilters: Record<string, boolean> = {
    outpost: true,
    castle: true,
    monument: true,
    laboratory: true,
    capital: true,
    royalTower: true,
    city: true,
  };
  public search = '';
  public worlds = [
    { name: 'Le Grand Empire', id: 0, icon: 'assets/dungeon0.png', ground: '#4c5c3a', field: '#6aa84f' },
    { name: 'Le Glacier éternel', id: 2, icon: 'assets/dungeon2.png', ground: '#4f6470', field: '#cfe4ec' },
    { name: 'Les Sables brûlants', id: 1, icon: 'assets/dungeon1.png', ground: '#6b5b3c', field: '#e3cd8a' },
    { name: 'Les Pics du feu', id: 3, icon: 'assets/dungeon3.png', ground: '#55392c', field: '#b0603a' },
    { name: 'Les Îles orageuses', id: 4, icon: 'assets/dungeon4.png', ground: '#2c4f5f', field: '#2fa3c4' },
  ];
  public playersByWorld: Record<number, number> = {};
  public powerTiers: PowerTier[] = [];
  public hiddenTiers = new Set<number>();
  public allianceSearch = '';
  public quantity: CastleQuantity = {
    castle: 0,
    outpost: 0,
    monument: 0,
    laboratory: 0,
    capital: 0,
    royalTower: 0,
    city: 0,
    patriarch: 0,
  };
  public filters = this.getFilters();

  public readonly monumentsColumns: ModalTableColumn[] = [
    { label: 'Type de patrimoine', sortKey: 'type' },
    { label: 'Position', sortKey: 'position' },
    { label: 'Propriétaire', sortKey: 'owner' },
  ];

  public readonly densityGradient = `linear-gradient(90deg, ${DENSITY_STOPS.map((c) => `rgb(${c.join(',')})`).join(', ')})`;

  private alliances: ApiCartoMap[] = [];
  private hiddenLegendKeys = new Set<string>();
  private castleMarkers: CastleMarker[] = [];
  private buildingMarkers: BuildingMarker[] = [];
  private fitZoom = 0;
  private L!: typeof Leaflet;
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly windowService = inject(WindowService);
  private readonly serverService = inject(ServerService);
  private allianceName: string | null = null;
  private filteredCastles: Castle[] = [];
  private playerLayers: Record<string, L.LayerGroup> = {};
  private selectedPolylines: L.Polyline[] = [];
  private readonly containerSize: number = WorldSizeDimensions.X.MAX;
  private selectedPlayer: string | null = null;
  private colorByKey = new Map<string, string>();
  private resizeObserver: ResizeObserver | null = null;
  private readonly documentListeners = new AbortController();

  public async ngAfterViewInit(): Promise<void> {
    if (this.isBrowser) {
      const leafletModule = await import('leaflet');
      this.L = leafletModule.default ?? leafletModule;
      this.initMap();
      this.observeStageSize();
      document.addEventListener('fullscreenchange', () => this.syncFullscreenState(), {
        signal: this.documentListeners.signal,
      });
    }
    setTimeout(() => {
      this.map.invalidateSize();
    }, 100);
    if (
      !this.route.snapshot.queryParamMap.get('size') &&
      !this.route.snapshot.params['alliance'] &&
      !this.route.snapshot.params['custom']
    ) {
      void this.router.navigate(['/map'], {
        queryParams: { size: 5 },
        onSameUrlNavigation: 'reload',
      });
    }
    combineLatest([this.route.queryParamMap, this.route.paramMap]).subscribe(([queryParameters, routeParameters]) => {
      const size = Number.parseInt(queryParameters.get('size') || '');
      const world = Number.parseInt(queryParameters.get('world') || '0');
      const parameterIn = queryParameters.get('in');
      const colors = queryParameters.get('c');
      const alliance = routeParameters.get('alliance');
      const server = queryParameters.get('srv') || this.serverService.currentServer?.name;
      if (!server) return;
      if (server !== this.serverService.currentServer?.name) {
        this.serverService.changeServer(server);
      }
      this.selectedWorld = world;
      this.colorByKey.clear();
      this.hiddenLegendKeys.clear();
      this.hiddenTiers.clear();
      this.alliances = [];
      this.initMap();
      if (size !== null && !Number.isNaN(size)) {
        void this.initWithAlliances(size);
      } else if (alliance) {
        if (alliance === 'custom' && parameterIn) {
          try {
            const parsedParameter = JSON.parse(decodeURIComponent(parameterIn));
            let parsedColors = [];
            try {
              parsedColors = JSON.parse(decodeURIComponent(colors || '[]') || '[]');
            } catch {}
            void this.initWithSpecificAlliance(parsedParameter, WatchModeStats.ALL_ALLIANCES, parsedColors);
          } catch {
            this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
          }
        } else {
          this.allianceName = alliance;
          this.allianceSearch = alliance;
          void this.initWithSpecificAlliance(alliance);
        }
      }
    });
  }

  public ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.documentListeners.abort();
    this.map?.remove();
  }

  public toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.mapStageRef.nativeElement.requestFullscreen?.();
    }
  }

  public fitWorld(): void {
    if (!this.map) return;
    const size = this.map.getSize();
    if (size.x === 0 || size.y === 0) return;
    this.map.fitBounds(this.worldBounds(), { paddingTopLeft: [0, MAP_TOP_PADDING], paddingBottomRight: [0, 8] });
  }

  public get activeWorld(): (typeof this.worlds)[number] {
    return this.worlds.find((world) => world.id === this.selectedWorld) ?? this.worlds[0];
  }

  public get disabledFilterCount(): number {
    return Object.values(this.formFilters).filter((enabled) => !enabled).length;
  }

  public isTypeVisible(group: 'castle' | 'outpost' | 'building'): boolean {
    if (group !== 'building') return this.formFilters[group];
    return this.buildingFilterKeys().some((key) => this.formFilters[key]);
  }

  public toggleType(group: 'castle' | 'outpost' | 'building'): void {
    const visible = !this.isTypeVisible(group);
    const keys = group === 'building' ? this.buildingFilterKeys() : [group];
    keys.forEach((key) => (this.formFilters[key] = visible));
    this.applyFilters();
  }

  public toggleTier(index: number): void {
    if (this.hiddenTiers.has(index)) {
      this.hiddenTiers.delete(index);
    } else {
      this.hiddenTiers.add(index);
    }
    this.applyFilters();
  }

  public submitAllianceSearch(): void {
    const alliance = this.allianceSearch.trim();
    if (alliance) this.searchAlliance(alliance);
  }

  public onMouseMove(event: MouseEvent): void {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const rows = this.heatmap.length;
    const cols = this.heatmap[0]?.length || 0;
    if (rows === 0 || cols === 0) return;
    const cellWidth = canvasWidth / cols;
    const cellHeight = canvasHeight / rows;
    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);
    if (this.heatmap[row]?.[col]) {
      this.showCellDetails(row, col, this.heatmap[row][col], event);
    } else {
      this.hideCellDetails();
    }
  }

  /**
   * This function is used to change the size of the map.
   * @param all {boolean} - If true, we load all alliances, otherwise we load the alliances quantity from this.alliancesQuantity
   * @returns {void}
   */
  public changeMapSize(all: boolean): void {
    const confirmMessage = this.translateService.instant('loading-confirmation');
    // We check if the user wants to load all alliances, if so, we show a confirmation message
    // This is useful to avoid loading all alliances if the user does not want to, because it can take a lot of time
    if (all && !confirm(confirmMessage)) return;
    void this.router.navigate(['/map'], {
      queryParams: { size: all ? -1 : this.alliancesQuantity },
      onSameUrlNavigation: 'reload',
    });
  }

  /**
   * This function is used to show the details of a cell in the heatmap 2D Heatmap rendering.
   * @param row The row of the cell
   * @param col The column of the cell
   * @param cell The cell data { pp: number; players: string[] }
   * @param event The mouse event or focus event
   */
  public showCellDetails(row: number, col: number, cell: HeatmapCell, event: MouseEvent | FocusEvent): void {
    const win = this.windowService.getWindow();
    if (!win) return;
    const mouseEvent = event as MouseEvent;
    const x = col * this.resolution;
    const y = row * this.resolution;
    const last = this.resolution - 1;
    this.tooltipData = {
      coords: `X ${x}–${x + last} · Y ${y}–${y + last}`,
      pp: cell.pp,
      players: cell.players,
    };
    const tooltipWidth = 280;
    const tooltipHeight = 200;
    const offset = 14;
    this.tooltipX =
      mouseEvent.clientX + offset + tooltipWidth > win.innerWidth
        ? Math.max(8, mouseEvent.clientX - offset - tooltipWidth)
        : mouseEvent.clientX + offset;
    this.tooltipY =
      mouseEvent.clientY + offset + tooltipHeight > win.innerHeight
        ? Math.max(8, mouseEvent.clientY - offset - tooltipHeight)
        : mouseEvent.clientY + offset;
    this.tooltipVisible = true;
  }

  public hideCellDetails(): void {
    this.tooltipVisible = false;
  }

  /**
   * This function is used to update the selected world.
   * @param world ID of the world
   * @returns {void}
   */
  public selectWorld(world: number): void {
    this.isInLoading = true;
    this.cdr.detectChanges();
    this.selectedWorld = world;
    if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE) {
      void this.router.navigate(['/map/' + this.allianceName], {
        queryParams: { world: world },
        onSameUrlNavigation: 'reload',
      });
    } else {
      const castles = this.mapCastleFromData(this.alliances);
      this.castles = [];
      this.filteredCastles = [];
      this.initMap();
      this.castles = castles.filter((entry: Castle) => entry.castles && entry.castles.length > 0);
      this.filteredCastles = this.getFilteredCastles(this.castles);
      this.generateHeatmap();
      setTimeout(() => {
        this.genericInit();
        this.isInLoading = false;
        this.cdr.detectChanges();
      }, 100);
    }
  }

  /**
   * This is a legacy function that is not used anymore.
   * This was used to download the map as a PNG file.
   * It is not used anymore because there is a lot of problems with the Leaflet library and the map rendering.
   * @deprecated This function is not used anymore.
   */
  public async downloadMap(): Promise<void> {
    try {
      this.downloadLoading = true;
      this.cdr.detectChanges();
      if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE) {
        const parameter = 'allianceId=' + this.route.snapshot.params['allianceId'];
        const url: ApiResponse<Blob> = await this.apiRestService.getScreenshot(parameter);
        if (!url.success) throw new Error(url.error);
        const blob = url.data;
        const urlBlob = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlBlob;
        const filename = 'map-' + this.route.snapshot.params['allianceId'] + '.png';
        a.download = filename;
        this.downloadLoading = false;
        this.cdr.detectChanges();
        a.click();
      } else {
        const parameter = 'size=' + this.alliancesQuantity;
        const url: ApiResponse<Blob> = await this.apiRestService.getScreenshot(parameter);
        if (!url.success) throw new Error(url.error);
        const blob = url.data;
        const urlBlob = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlBlob;
        const filename = 'map' + (this.alliancesQuantity === -1 ? '' : '-' + this.alliancesQuantity) + '.png';
        a.download = filename;
        this.downloadLoading = false;
        this.cdr.detectChanges();
        a.click();
      }
    } catch {
      this.downloadLoading = false;
      this.cdr.detectChanges();
    }
  }

  public isPlayerHidden(key: string): boolean {
    return this.hiddenLegendKeys.has(key);
  }

  public generateHeatmap(): void {
    if (!this.resolution || Number.isNaN(this.resolution) || this.resolution <= 0) return;
    if (this.resolution > 50) this.resolution = 50;
    const numberCells: number = Math.ceil(this.containerSize / this.resolution);
    this.heatmap = Array.from({ length: numberCells }, () =>
      Array.from({ length: numberCells }, () => ({ pp: 0, players: [], playerCount: 0 })),
    );
    const players = this.filteredCastles;
    const t = this.translateService;
    players.forEach((player) => {
      const countedCells = new Set<HeatmapCell>();
      player.castles.forEach(([x, y, _]) => {
        if (_ === CastleType.LABORATORY || _ === CastleType.MONUMENT || _ === CastleType.ROYAL_TOWER) return;
        const row = Math.floor(y / this.resolution);
        const col = Math.floor(x / this.resolution);
        if (this.heatmap[row]?.[col] !== undefined) {
          const nbCastles = player.castles.filter(
            (castle) =>
              castle[2] !== CastleType.MONUMENT &&
              castle[2] !== CastleType.LABORATORY &&
              castle[2] !== CastleType.ROYAL_TOWER,
          ).length;
          const pp = player.pp / nbCastles;
          const cell = this.heatmap[row][col];
          cell.pp += pp;
          cell.players.push(player.name + ' (' + t.instant(this.getCastleType(_)) + ')');
          if (!countedCells.has(cell)) {
            countedCells.add(cell);
            cell.playerCount++;
          }
        }
      });
    });
    this.maxIntensity = Math.max(0, ...this.heatmap.flat().map((cell) => cell.playerCount));
    this.drawHeatmap();
  }

  public searchAlliance(alliance: string): void {
    if (!this.isBrowser) return;
    globalThis.location.href = '/map/' + encodeURIComponent(alliance);
  }

  public async removeItem(allianceOrPlayerName: string): Promise<void> {
    if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE || allianceOrPlayerName === '') return;
    this.isInLoading = true;
    const castles = this.castles.filter(
      (entry) => entry.name !== allianceOrPlayerName && entry.alliance_name !== allianceOrPlayerName,
    );
    this.alliances = this.alliances.filter(
      (entry) => entry.name !== allianceOrPlayerName && entry.alliance_name !== allianceOrPlayerName,
    );
    this.hiddenLegendKeys.delete(allianceOrPlayerName);
    const deepCopyCastles = structuredClone(castles);
    this.initMap();
    this.castles = deepCopyCastles;
    this.filteredCastles = this.getFilteredCastles(this.castles);
    this.generateHeatmap();
    setTimeout(() => {
      this.genericInit();
      this.isInLoading = false;
      this.cdr.detectChanges();
    }, 10);
  }

  public getFilters(): Array<{
    icon: string;
    alt: string;
    title: string;
    id: string;
    model: string;
    label: string;
  }> {
    return [
      {
        icon: '/assets/square-outpost.png',
        alt: 'Avant-poste',
        title: 'Afficher ou non les avant-postes',
        id: 'outpostFilter',
        model: 'outpost',
        label: 'Afficher les avant-postes',
      },
      {
        icon: '/assets/square-castle.png',
        alt: 'Château',
        title: 'Afficher ou non les châteaux',
        id: 'castleFilter',
        model: 'castle',
        label: 'Afficher les châteaux',
      },
      {
        icon: '/assets/square-monument.png',
        alt: 'Monument',
        title: 'Afficher ou non les monuments',
        id: 'monumentFilter',
        model: 'monument',
        label: 'Afficher les monuments',
      },
      {
        icon: '/assets/square-labo.png',
        alt: 'Laboratoire',
        title: 'Afficher ou non les laboratoires',
        id: 'laboratoryFilter',
        model: 'laboratory',
        label: 'Afficher les laboratoires',
      },
      {
        icon: '/assets/square-capital.png',
        alt: 'Capitale',
        title: 'Afficher ou non les capitales',
        id: 'capitalFilter',
        model: 'capital',
        label: 'Afficher les capitales',
      },
      {
        icon: '/assets/square-royal-tower.png',
        alt: 'Tour royale',
        title: 'Afficher ou non les tours royales',
        id: 'royalTowerFilter',
        model: 'royalTower',
        label: 'Afficher les tours royales',
      },
      {
        icon: '/assets/square-trade.png',
        alt: 'Cité marchande',
        title: 'Afficher ou non les cités marchandes',
        id: 'cityFilter',
        model: 'city',
        label: 'Afficher les cités marchandes',
      },
    ];
  }

  public saveLink(): void {
    if (!this.isBrowser) return;
    const castleIds = this.castles.map((c) => c.alliance_id);
    const uniqueCastleIds = [...new Set(castleIds)];
    const inParameter = JSON.stringify(uniqueCastleIds);
    const colors = JSON.stringify(this.legends.map((legend) => this.rgbToHex(legend.color)));
    const world = this.selectedWorld || 0;
    const srv = encodeURIComponent(this.serverService.currentServer?.name ?? '');
    const link = `${globalThis.location.origin}/map/custom?srv=${srv}&world=${world}&in=${encodeURIComponent(inParameter)}&c=${encodeURIComponent(colors)}`;
    if (link.length > 2000) {
      // If the link is too long, we show an error message (this is a limitation of the URL length)
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    globalThis.navigator.clipboard
      .writeText(link)
      .then(() => {
        this.toastService.add(ErrorType.COPIED_TO_CLIPBOARD, 5000, 'info');
      })
      .catch(() => {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      });
  }

  public async loadNewAlliance(alliance: string): Promise<void> {
    if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE || alliance === '') {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    if (alliance === '1') {
      // Alliance "1" is a special case for unallied players
      // Before loading the unallied players, we ask for confirmation
      // This is to avoid loading the unallied players by mistake
      const confirmMessage = this.translateService.instant('loading-confirmation');
      if (!confirm(confirmMessage)) return;
    }
    const targetedAlliance = this.castles.filter(
      (entry) => String(entry.alliance_name).toLowerCase() === alliance.toLowerCase(),
    );
    if (targetedAlliance.length > 0) {
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
      return;
    }
    this.isInLoading = true;
    this.cdr.detectChanges();
    const response = await this.apiRestService.getCartoAllianceByName(alliance, this.selectedWorld);
    if (!response.success || response.data.length === 0) {
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 50_000);
      this.isInLoading = false;
      this.cdr.detectChanges();
      return;
    } else {
      this.toastService.add(ErrorType.ALLIANCE_ADDED, 5000, 'info');
    }
    if (alliance === '1') {
      // Alliance "1" is the unallied players, not the name of the alliance.
      // So, we toggle the showUnallied property
      this.showUnallied = !this.showUnallied;
    }
    const data = response.data;
    const castles = this.mapCastleFromData(data);
    // We need to filter the castles to remove the ones that are already in the list
    this.castles.push(...castles);
    this.castles = this.castles.filter((entry) => entry.castles && entry.castles.length > 0);
    const deepCopyCastles = structuredClone(this.castles);
    const oldLegends = structuredClone(this.legends);
    this.initMap();
    this.castles = deepCopyCastles;
    this.filteredCastles = this.getFilteredCastles(this.castles);
    this.generateHeatmap();
    setTimeout(() => {
      this.genericInit();
      this.setOldLegendColors(oldLegends);
      this.isInLoading = false;
      this.cdr.detectChanges();
    }, 10);
  }

  public setOldLegendColors(oldLegends: ILegend[]): void {
    oldLegends.forEach((oldLegend) => {
      const currentLegend = this.legends.find((legend) => legend.name === oldLegend.name);
      const hasColorChanged = currentLegend && currentLegend.color !== oldLegend.color;
      if (currentLegend && hasColorChanged) {
        const hexColor = this.rgbToHex(oldLegend.color);
        this.changeItemColor(currentLegend.name, hexColor);
      }
    });
  }

  public toggleLegendItem(name: string): void {
    const layer = this.playerLayers[name];
    if (this.hiddenLegendKeys.has(name)) {
      this.hiddenLegendKeys.delete(name);
      if (!layer) {
        this.applyFilters();
        return;
      }
      layer.addTo(this.map);
      this.filteredCastles.push(
        ...this.getFilteredCastles(this.castles.filter((entry) => this.colorKeyOf(entry) === name)),
      );
    } else {
      this.hiddenLegendKeys.add(name);
      if (layer) this.map.removeLayer(layer);
      this.filteredCastles = this.filteredCastles.filter((entry) => this.colorKeyOf(entry) !== name);
    }
    this.refreshVisibleTotals();
  }

  public changeItemColor(allianceOrPlayerName: string, eventTarget: EventTarget | null | string): void {
    const color = this.hexToRgb(
      typeof eventTarget === 'string' ? eventTarget : (eventTarget as HTMLInputElement).value,
    );
    this.colorByKey.set(allianceOrPlayerName, color);
    this.legends = this.legends.map((legend) => (legend.name === allianceOrPlayerName ? { ...legend, color } : legend));
    this.playerLayers[allianceOrPlayerName]?.eachLayer((layer: L.Layer) => this.recolorLayer(layer, color));
    this.setMonuments();
    this.cdr.detectChanges();
  }

  public addTransparentToRgb(rgb: string): string {
    const result = rgb.match(/\d+/g);
    if (!result || result.length < 3) return 'rgba(0, 0, 0, 0.08)';
    return `rgba(${result[0]}, ${result[1]}, ${result[2]}, 0.08)`;
  }

  public rgbToHex(rgb: string): string {
    const result = rgb.match(/\d+/g);
    if (!result || result.length < 3) return '#000000';
    return (
      '#' +
      result
        .slice(0, 3)
        .map((x) => {
          const hex = Number.parseInt(x, 10).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('')
    );
  }

  public readonly monumentsSearchFilter = (item: Monument, term: string): boolean =>
    item.type.toLowerCase().includes(term) ||
    item.position.toLowerCase().includes(term) ||
    item.owner.toLowerCase().includes(term);

  public hexToRgb(hex: string): string {
    const result = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!result) return 'rgb(0, 0, 0)';
    return `rgb(${Number.parseInt(result[1], 16)}, ${Number.parseInt(result[2], 16)}, ${Number.parseInt(result[3], 16)})`;
  }

  public applyFilters(): void {
    const castles = structuredClone(this.castles);
    this.initMap();
    this.castles = castles;
    this.filteredCastles = this.getFilteredCastles(this.castles);
    setTimeout(() => {
      this.genericInit();
      this.generateHeatmap();
      this.cdr.detectChanges();
    }, 100);
  }

  private recolorLayer(layer: L.Layer, color: string): void {
    if (layer instanceof this.L.LayerGroup) {
      layer.eachLayer((subLayer: L.Layer) => this.recolorLayer(subLayer, color));
    } else if (layer instanceof this.L.Path) {
      const isRing = layer.options.color === layer.options.fillColor;
      layer.setStyle(isRing ? { color, fillColor: color } : { fillColor: color });
    }
  }

  private refreshVisibleTotals(): void {
    this.fillQuantity();
    this.setMonuments();
    this.generateHeatmap();
    this.cdr.detectChanges();
  }

  private buildingFilterKeys(): string[] {
    return ['monument', 'laboratory', 'capital', 'royalTower', 'city'];
  }

  private getFilteredCastles(castle: Castle[]): Castle[] {
    const visible = castle.filter(
      (player) =>
        !this.hiddenLegendKeys.has(this.colorKeyOf(player)) &&
        !this.hiddenTiers.has(this.tierIndexOf(Number(player.pp))),
    );
    return visible.map((castle: Castle) => {
      return {
        ...castle,
        castles: castle.castles.filter((c) => {
          const castleType = c[2];
          return (
            (this.formFilters['outpost'] && castleType === CastleType.OUTPOST) ||
            (this.formFilters['castle'] &&
              (castleType === CastleType.CASTLE || castleType === CastleType.REALM_CASTLE)) ||
            (this.formFilters['monument'] && castleType === CastleType.MONUMENT) ||
            (this.formFilters['laboratory'] && castleType === CastleType.LABORATORY) ||
            (this.formFilters['capital'] && castleType === CastleType.CAPITAL) ||
            (this.formFilters['royalTower'] && castleType === CastleType.ROYAL_TOWER) ||
            (this.formFilters['city'] && castleType === CastleType.CITY)
          );
        }),
      };
    });
  }

  private genericInit(): void {
    this.computePowerTiers();
    this.countPlayersByWorld();
    this.plotCastles();
    this.setMonuments();
    this.nbPlayers = this.castles.length;
    this.isInLoading = false;
  }

  private async initWithSpecificAlliance(
    alliance: string | string[],
    watchMode = WatchModeStats.SPECIFIC_ALLIANCE,
    parsedColors: string[] | null = null,
  ): Promise<void> {
    this.watchModeAlliance = watchMode;
    const alliances = await this.loadAlliances(alliance);
    if (!alliances) {
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
      return;
    }
    const castles: Castle[] = [];
    alliances.forEach((alliance: ApiCartoAlliance[]) => {
      castles.push(...this.mapCastleFromData(alliance));
    });
    this.castles = castles.filter((entry) => entry.castles && entry.castles.length > 0);
    this.filteredCastles = this.castles;
    this.generateHeatmap();
    setTimeout(() => {
      this.genericInit();
      this.applyLegendColors(parsedColors);
      this.cdr.detectChanges();
    }, 100);
  }

  /**
   * This function is used to clear all properties of the component.
   * This is useful when we want to reset the component to its initial state.
   * Becausse the map is from a third party library (Leaflet), we need to clear all layers and properties
   * to avoid memory leaks and to ensure that the map is in a clean state.
   * @returns {void}
   */
  private clearAllProperties(): void {
    this.filteredCastles = [];
    this.playerLayers = {};
    this.castleMarkers = [];
    this.buildingMarkers = [];
    this.selectedPolylines = [];
    this.selectedPlayer = null;
    this.maxIntensity = 0;
    this.tooltipVisible = false;
    this.tooltipX = 0;
    this.tooltipY = 0;
    this.tooltipData = { coords: '', pp: 0, players: [] };
    this.legends = [];
    this.castles = [];
    this.nbPlayers = 0;
    this.monumentsList = [];
    this.quantity = {
      castle: 0,
      outpost: 0,
      monument: 0,
      laboratory: 0,
      capital: 0,
      royalTower: 0,
      city: 0,
      patriarch: 0,
    };
    this.heatmap = [];
    this.isInLoading = true;
  }

  private clearLayers(): void {
    if (this.map) {
      this.map.eachLayer((layer) => {
        this.map.removeLayer(layer);
      });
    }
  }

  private async initWithAlliances(nbAlliances: number): Promise<void> {
    this.alliancesQuantity = nbAlliances;
    this.loadedAlliancesQuantity = nbAlliances;
    this.watchModeAlliance = WatchModeStats.ALL_ALLIANCES;
    const response = await this.apiRestService.getCartoMap(nbAlliances, this.selectedWorld);
    if (!response.success) throw new Error(response.error);
    const data = response.data;
    this.castles = this.mapCastleFromData(data);
    this.castles = this.castles.filter((entry) => entry.castles && entry.castles.length > 0);
    this.filteredCastles = this.castles;
    this.generateHeatmap();
    this.genericInit();
    this.cdr.detectChanges();
  }

  private addAlliances(alliances: ApiCartoMap[]): void {
    alliances.forEach((alliance: ApiCartoMap) => {
      if (!this.alliances.some((a) => a.name === alliance.name)) {
        this.alliances.push({
          name: alliance.name,
          castles: alliance.castles,
          castles_realm: alliance.castles_realm,
          might_current: alliance.might_current,
          alliance_id: alliance.alliance_id,
          alliance_name: alliance.alliance_name,
        });
      }
    });
  }

  private mapCastleFromData(data: ApiCartoMap[] | ApiCartoAlliance[]): Castle[] {
    this.addAlliances(data as ApiCartoMap[]);
    const result = data.map((entry) => {
      const castles = entry.castles ?? [];
      const realmCastles = entry.castles_realm ?? [];
      let selectedCastles: [number, number, number][] = [];
      if (this.selectedWorld === 0) {
        selectedCastles = castles;
      } else {
        selectedCastles = realmCastles
          .filter((castle: number[]) => castle[0] === this.selectedWorld)
          .map((castle: number[]) => [castle[1], castle[2], castle[3]]);
      }
      return {
        name: entry.name,
        castles: selectedCastles,
        pp: entry.might_current,
        alliance_id: 'alliance_id' in entry ? entry.alliance_id : undefined,
        alliance_name: 'alliance_name' in entry ? entry.alliance_name : undefined,
      };
    });
    return result;
  }

  private initRectangle(): void {
    this.L.rectangle(this.worldBounds(), {
      color: 'rgba(0, 0, 0, 0.55)',
      weight: 1.5,
      fillColor: this.activeWorld.field,
      fillOpacity: 0.4,
    })
      .on('click', () => this.highlightPlayerCastles(null))
      .addTo(this.map);
    this.drawGrid();
  }

  private drawGrid(): void {
    const max = WorldSizeDimensions.X.MAX;
    const lines: L.LatLngExpression[][] = [];
    for (let step = MAP_GRID_STEP; step < max; step += MAP_GRID_STEP) {
      lines.push(
        [
          [step, 0],
          [step, max],
        ],
        [
          [0, step],
          [max, step],
        ],
      );
    }
    this.L.polyline(lines, { color: '#ffffff', opacity: 0.06, weight: 1, interactive: false }).addTo(this.map);
  }

  private worldBounds(): L.LatLngBoundsExpression {
    return [
      [WorldSizeDimensions.Y.MIN, WorldSizeDimensions.X.MIN],
      [WorldSizeDimensions.Y.MAX, WorldSizeDimensions.X.MAX],
    ];
  }

  /**
   * Default function to initialize the map.
   * This function is used to set the center of the map and the zoom level.
   * It is also used to set the max bounds of the map.
   * We also set the attribution control to false to avoid showing the Leaflet attribution.
   * @returns {void}
   */
  private initMap(): void {
    if (this.map) {
      this.clearAllProperties();
      this.clearLayers();
    } else {
      this.createMap();
    }
    this.initRectangle();
  }

  private createMap(): void {
    const margin = 100;
    this.map = this.L.map('map', {
      attributionControl: false,
      crs: this.L.CRS.Simple,
      preferCanvas: true,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      minZoom: -4,
      maxZoom: 4,
      maxBounds: [
        [WorldSizeDimensions.Y.MIN - margin, WorldSizeDimensions.X.MIN - margin],
        [WorldSizeDimensions.Y.MAX + margin, WorldSizeDimensions.X.MAX + margin],
      ],
    });
    const center = WorldSizeDimensions.X.MAX / 2;
    this.map.setView([center, center], -1);
    this.fitWorld();
    this.fitZoom = this.map.getZoom();
    this.map.on('mousemove', (event: L.LeafletMouseEvent) => this.updateCursorCoords(event.latlng));
    this.map.on('mouseout', () => this.updateCursorCoords(null));
    this.map.on('zoomend', () => this.applyZoomScale());
  }

  private applyZoomScale(): void {
    const zoomGain = this.map.getZoom() - this.fitZoom;
    const stageFactor = Math.min(1.2, Math.max(0.6, this.map.getSize().x / 700));
    const scale = stageFactor * Math.min(4, Math.max(0.8, Math.SQRT2 ** zoomGain));
    this.castleMarkers.forEach(({ marker, baseRadius }) => marker.setRadius(baseRadius * scale));
    const pixelsPerUnit = 2 ** this.map.getZoom();
    this.buildingMarkers.forEach(({ polygon, x, y, basePx }) =>
      polygon.setLatLngs(this.hexagon(x, y, (basePx * scale) / pixelsPerUnit)),
    );
    const container = this.map.getContainer();
    POWER_TIER_LABEL_ZOOM.forEach((offset, index) => {
      container.classList.toggle(`show-tier-${index}`, offset !== null && zoomGain >= offset);
    });
  }

  private syncFullscreenState(): void {
    this.isFullscreen = document.fullscreenElement === this.mapStageRef.nativeElement;
    this.cdr.detectChanges();
  }

  private updateCursorCoords(latlng: L.LatLng | null): void {
    const x = latlng ? Math.round(latlng.lng) : -1;
    const y = latlng ? Math.round(WorldSizeDimensions.Y.MAX - latlng.lat) : -1;
    const inside = x >= 0 && y >= 0 && x <= WorldSizeDimensions.X.MAX && y <= WorldSizeDimensions.Y.MAX;
    const coords = inside ? `${x} : ${y}` : null;
    if (coords === this.cursorCoords) return;
    this.cursorCoords = coords;
    this.cdr.detectChanges();
  }

  private observeStageSize(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.drawHeatmap();
      if (!this.map) return;
      const container = this.map.getContainer();
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      const wasShowingWorld = this.map.getZoom() <= this.fitZoom + 0.25;
      this.map.invalidateSize();
      const fitZoom = this.map.getBoundsZoom(this.worldBounds(), false, this.L.point(0, MAP_TOP_PADDING + 8));
      if (!Number.isFinite(fitZoom)) return;
      this.fitZoom = fitZoom;
      this.map.setMinZoom(fitZoom - 0.5);
      if (wasShowingWorld) this.fitWorld();
      this.applyZoomScale();
    });
    this.resizeObserver.observe(this.mapStageRef.nativeElement);
    const heatmapFrame = this.canvasRef.nativeElement.parentElement;
    if (heatmapFrame) this.resizeObserver.observe(heatmapFrame);
  }

  private formatXCord(x: number): number {
    return WorldSizeDimensions.X.MAX - x;
  }

  private addLegend(): void {
    if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE) {
      const players = [...this.castles].sort((a, b) => Number(b.pp) - Number(a.pp));
      this.legends = players.map((player) => ({
        name: player.name,
        color: this.assignColor(player.name),
        detail: this.formatPp(Number(player.pp)),
      }));
    } else {
      const membersByAlliance = new Map<string, number>();
      this.castles.forEach((castle) => {
        if (!castle.alliance_name) return;
        membersByAlliance.set(castle.alliance_name, (membersByAlliance.get(castle.alliance_name) ?? 0) + 1);
      });
      this.legends = [...membersByAlliance].map(([name, members]) => ({
        name,
        color: this.assignColor(name),
        detail: String(members),
      }));
      this.loadedAlliancesQuantity = this.legends.length;
    }
  }

  private fillQuantity(): void {
    this.quantity = {
      castle: 0,
      outpost: 0,
      monument: 0,
      laboratory: 0,
      capital: 0,
      royalTower: 0,
      city: 0,
      patriarch: 0,
    };
    this.filteredCastles.forEach((player) => {
      player.castles.forEach((castle: number[]) => {
        const target = castle[2];
        switch (target) {
          case CastleType.CASTLE: {
            this.quantity.castle++;
            break;
          }
          case CastleType.REALM_CASTLE: {
            this.quantity.castle++;
            break;
          }
          case CastleType.OUTPOST: {
            this.quantity.outpost++;
            break;
          }
          case CastleType.MONUMENT: {
            this.quantity.monument++;
            this.quantity.patriarch++;
            break;
          }
          case CastleType.LABORATORY: {
            this.quantity.laboratory++;
            this.quantity.patriarch++;
            break;
          }
          case CastleType.CAPITAL: {
            this.quantity.capital++;
            this.quantity.patriarch++;
            break;
          }
          case CastleType.ROYAL_TOWER: {
            this.quantity.royalTower++;
            this.quantity.patriarch++;
            break;
          }
          case CastleType.CITY: {
            this.quantity.city++;
            this.quantity.patriarch++;
            break;
          }
          default: {
            break;
          }
        }
      });
    });
  }

  private generateShape(
    castleType: CastleType,
    x: number,
    y: number,
    tierRadius: number,
    color: string,
  ): L.Polygon | L.CircleMarker {
    if (castleType === CastleType.OUTPOST) {
      return this.trackMarker(
        this.L.circleMarker([y, x], { color, fillColor: color, fillOpacity: 0.25, weight: 1.25, opacity: 0.9 }),
        OUTPOST_RADIUS,
      );
    }
    if (castleType === CastleType.CASTLE || castleType === CastleType.REALM_CASTLE) {
      return this.trackMarker(
        this.L.circleMarker([y, x], { color: '#14180f', fillColor: color, fillOpacity: 0.95, weight: 1 }),
        tierRadius,
      );
    }
    const basePx = this.getBuildingSize(castleType);
    const polygon = this.L.polygon(this.hexagon(x, y, basePx), {
      color: '#ffffff',
      fillColor: color,
      fillOpacity: 1,
      weight: 1,
    });
    this.buildingMarkers.push({ polygon, x, y, basePx });
    return polygon;
  }

  private hexagon(x: number, y: number, size: number): L.LatLngExpression[] {
    const halfWidth = (size * Math.sqrt(3)) / 2;
    return [
      [y - size, x],
      [y - size / 2, x + halfWidth],
      [y + size / 2, x + halfWidth],
      [y + size, x],
      [y + size / 2, x - halfWidth],
      [y - size / 2, x - halfWidth],
    ];
  }

  private trackMarker(marker: L.CircleMarker, baseRadius: number): L.CircleMarker {
    marker.setRadius(baseRadius);
    this.castleMarkers.push({ marker, baseRadius });
    return marker;
  }

  private getBuildingSize(castleType: CastleType): number {
    if (castleType === CastleType.MONUMENT || castleType === CastleType.LABORATORY) return 4;
    if (castleType === CastleType.ROYAL_TOWER) return 5;
    return 6;
  }

  /**
   * This function is used to generate the tooltip for the castle.
   * @param player Castle object
   * @param x X coordinate of the castle
   * @param inversedPositionY Y coordinate of the castle (inversed because of the map)
   * @param castleType Type of the castle (castle, outpost, etc.)
   * @returns {string} Tooltip string
   */
  private generateTooltip(player: Castle, x: number, inversedPositionY: number, castleType: string): string {
    const mp = this.translateService.instant('Points de puissance');
    const type = this.translateService.instant('Type');
    const alliance = this.translateService.instant('Alliance');
    const position = this.translateService.instant('Position');
    let tooltip = `<b>${this.escapeHtml(player.name)}</b><br>${mp}: ${this.formatPp(Number(player.pp))}<br>${type}: ${this.translateService.instant(castleType)}`;
    if (this.watchModeAlliance === WatchModeStats.ALL_ALLIANCES) {
      tooltip += `<br>${alliance}: ${this.escapeHtml(player.alliance_name ?? '')}`;
    }
    tooltip += `<br><br>${position}: ${x}, ${inversedPositionY}`;
    return tooltip;
  }

  /**
   * Rendering method for the castles.
   * This method is used to plot the castles on the map.
   * It is used to plot the castles on the map with a specific color, size and shape.
   * We also bind a tooltip to the castle to show the details of the castle.
   * @returns {void}
   */
  private plotCastles(): void {
    const one = this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE;
    this.addLegend();
    // Weakest first, so the strongest castles are drawn on top and never buried.
    const players = [...this.filteredCastles].sort((a, b) => Number(a.pp) - Number(b.pp));
    players.forEach((player: Castle) => {
      const color = this.colorFor(this.colorKeyOf(player));
      const tierIndex = this.tierIndexOf(Number(player.pp));
      const playerLayer = this.L.layerGroup();
      player.castles.forEach((castle: number[]) => {
        const [x, y] = [castle[0], this.formatXCord(castle[1])];
        const castleType = this.getCastleType(castle[2]);
        const shape = this.generateShape(castle[2], x, y, POWER_TIER_RADII[tierIndex], color);
        const tooltip = this.generateTooltip(player, x, WorldSizeDimensions.Y.MAX - y, castleType);
        shape.bindTooltip(tooltip, { permanent: false }).on('click', () => this.highlightPlayerCastles(player));
        playerLayer.addLayer(shape);
        if (castle[2] === CastleType.CASTLE || castle[2] === CastleType.REALM_CASTLE) {
          const label = this.createNameLabel(player.name, x, y, tierIndex);
          if (label) playerLayer.addLayer(label);
        }
      });
      if (one) {
        playerLayer.addTo(this.map);
        this.playerLayers[player.name] = playerLayer;
      } else if (player.alliance_name) {
        if (this.playerLayers[player.alliance_name]) {
          this.playerLayers[player.alliance_name].addLayer(playerLayer);
        } else {
          const allianceLayer = this.L.layerGroup();
          allianceLayer.addLayer(playerLayer);
          allianceLayer.addTo(this.map);
          this.playerLayers[player.alliance_name] = allianceLayer;
        }
      }
    });
    this.applyZoomScale();
    this.fillQuantity();
  }

  private createNameLabel(name: string, x: number, y: number, tierIndex: number): L.Tooltip | null {
    if (POWER_TIER_LABEL_ZOOM[tierIndex] === null) return null;
    return this.L.tooltip([y, x], {
      content: this.escapeHtml(name),
      permanent: true,
      direction: 'top',
      offset: [0, -POWER_TIER_RADII[tierIndex]],
      // eslint-disable-next-line unicorn/no-keyword-prefix -- Leaflet option name
      className: `castle-label tier-${tierIndex}`,
      interactive: false,
    });
  }

  private computePowerTiers(): void {
    const might = this.alliances.map((player) => Number(player.might_current)).sort((a, b) => b - a);
    let rank = 0;
    this.powerTiers = POWER_TIER_RADII.map((radius, index) => {
      const share = POWER_TIER_SHARES[index];
      const end =
        share === undefined
          ? might.length
          : Math.min(might.length, rank + Math.max(1, Math.round(might.length * share)));
      const tier: PowerTier = {
        minMight: end > rank ? might[end - 1] : Number.POSITIVE_INFINITY,
        radius,
        players: end - rank,
        labelZoomOffset: POWER_TIER_LABEL_ZOOM[index],
      };
      rank = end;
      return tier;
    });
  }

  private tierIndexOf(might: number): number {
    const index = this.powerTiers.findIndex((tier) => tier.players > 0 && might >= tier.minMight);
    return index === -1 ? POWER_TIER_RADII.length - 1 : index;
  }

  private countPlayersByWorld(): void {
    const counts: Record<number, number> = {};
    this.worlds.forEach((world) => {
      counts[world.id] = this.alliances.filter((player) =>
        world.id === 0
          ? (player.castles ?? []).length > 0
          : (player.castles_realm ?? []).some((castle) => castle[0] === world.id),
      ).length;
    });
    this.playersByWorld = counts;
  }

  /**
   * This function is used to highlight the castles of a player.
   * It is used to show the castles of a player when the user clicks on the castle.
   * It is triggered by the click event on the castle.
   * @param player Castle object or string
   * @returns {void}
   */
  private highlightPlayerCastles(player: Castle | null | string): void {
    if (player === null) {
      this.selectedPlayer = null;
      if (this.selectedPolylines) {
        this.selectedPolylines.forEach((polyline) => this.map.removeLayer(polyline));
      }
      return;
    }
    if (typeof player === 'string') {
      const castle = this.castles.find((p) => p.name === player);
      if (!castle) return;
      player = castle;
    }
    if (this.selectedPolylines) {
      this.selectedPolylines.forEach((polyline) => this.map.removeLayer(polyline));
    }
    if (this.selectedPlayer === player.name) {
      this.fitWorld();
      this.selectedPlayer = null;
      return;
    }
    this.selectedPlayer = player.name;
    let castleCoordinates = player.castles.map((castle: number[]) => [
      this.formatXCord(castle[1]),
      castle[0],
      castle[2],
    ]);
    const selectedCastle = castleCoordinates.find(
      (castle) => castle[2] === CastleType.CASTLE || castle[2] === CastleType.REALM_CASTLE,
    );
    if (!selectedCastle) return;
    castleCoordinates = castleCoordinates.map((castle) => [castle[0], castle[1]] as [number, number]);
    this.selectedPolylines = [];
    // We draw lines between the selected castle and all other castles of the player
    castleCoordinates.forEach((coord) => {
      if (coord !== selectedCastle) {
        // However, we don't draw a line between the castle and itself
        const polyline = this.L.polyline([selectedCastle as L.LatLngExpression, coord as L.LatLngExpression], {
          color: this.colorFor(this.colorKeyOf(player)),
          weight: 2,
          dashArray: '6 4',
        }).addTo(this.map);
        this.selectedPolylines.push(polyline);
      }
    });
    if (player.castles.length > 1) {
      const bounds = this.L.latLngBounds(castleCoordinates as [number, number][]);
      this.map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      this.map.setView([selectedCastle[0], selectedCastle[1]], 6);
    }
  }

  /**
   * This function is used to fill the monuments list
   * It is used to show the monument list
   * @returns {void}
   */
  private setMonuments(): void {
    // We filter the castles to get only the monuments
    const allMonuments = this.filteredCastles.filter((entry) =>
      entry.castles.some(
        (castle) =>
          castle[2] !== CastleType.CASTLE && castle[2] !== CastleType.REALM_CASTLE && castle[2] !== CastleType.OUTPOST,
      ),
    );
    const monumentsList: {
      type: string;
      position: string;
      owner: string;
      color: string;
    }[] = [];
    allMonuments.forEach((entry) => {
      entry.castles.forEach((castle) => {
        if (castle[2] !== CastleType.CASTLE && castle[2] !== CastleType.OUTPOST) {
          monumentsList.push({
            type: this.translateService.instant(this.getCastleType(castle[2])),
            position: `${castle[0]}, ${castle[1]}`,
            owner: entry.name,
            color: this.colorFor(this.colorKeyOf(entry)),
          });
        }
      });
    });
    monumentsList.sort((a, b) => a.type.localeCompare(b.type) || a.owner.localeCompare(b.owner));
    this.monumentsList = monumentsList;
  }

  /**
   * This function is used to format the Might Points (PP) of a player.
   * It is used to show the Might Points in a human readable format.
   * For example, 1000 will be shown as 1K, 1000000 will be shown as 1M, etc.
   * @param pp The Might Points of the player
   * @returns {string} The formatted Might Points
   */
  private formatPp(pp: number): string {
    if (pp < 1000) return pp.toString();
    if (pp < 1_000_000) return (pp / 1000).toFixed(2) + 'K';
    if (pp < 1_000_000_000) return (pp / 1_000_000).toFixed(2) + 'M';
    return (pp / 1_000_000_000).toFixed(2) + 'B';
  }

  private escapeHtml(text: string): string {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replaceAll(/["&'<>]/g, (char) => entities[char]);
  }

  private colorKeyOf(player: Castle): string {
    return this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE ? player.name : (player.alliance_name ?? '');
  }

  private colorFor(key: string): string {
    return this.colorByKey.get(key) ?? this.assignColor(key);
  }

  private assignColor(key: string): string {
    const known = this.colorByKey.get(key);
    if (known) return known;
    const used = new Set(this.colorByKey.values());
    const color =
      key === UNALLIED_KEY
        ? UNALLIED_COLOR
        : (LEGEND_PALETTE.map((hex) => this.hexToRgb(hex)).find((rgb) => !used.has(rgb)) ??
          this.goldenAngleColor(this.colorByKey.size));
    this.colorByKey.set(key, color);
    return color;
  }

  private goldenAngleColor(index: number): string {
    const hue = (index * 137.508) % 360;
    const lightness = index % 2 === 0 ? 0.62 : 0.72;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * 0.8;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const sector = Math.floor(hue / 60);
    const [r, g, b] = [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ][sector];
    const m = lightness - chroma / 2;
    const channel = (value: number): number => Math.round((value + m) * 255);
    return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
  }

  private drawHeatmap(): void {
    const canvas = this.canvasRef.nativeElement;
    const frame = canvas.parentElement;
    const context = canvas.getContext('2d');
    if (!context || !frame || frame.clientWidth === 0) return;
    const size = Math.floor(Math.min(frame.clientWidth, frame.clientHeight || frame.clientWidth));
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    const rows = this.heatmap.length;
    const cols = this.heatmap[0]?.length || 0;
    if (rows === 0 || cols === 0) return;
    const cellSize = size / cols;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const count = this.heatmap[row][col].playerCount;
        if (count === 0) continue;
        context.fillStyle = this.getDensityColor(count);
        context.fillRect(col * cellSize, row * cellSize, Math.ceil(cellSize), Math.ceil(cellSize));
      }
    }
    this.drawHeatmapGrid(context, size);
  }

  private drawHeatmapGrid(context: CanvasRenderingContext2D, size: number): void {
    const scale = size / WorldSizeDimensions.X.MAX;
    context.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    context.lineWidth = 1;
    context.beginPath();
    for (let step = MAP_GRID_STEP; step < WorldSizeDimensions.X.MAX; step += MAP_GRID_STEP) {
      const position = Math.round(step * scale) + 0.5;
      context.moveTo(position, 0);
      context.lineTo(position, size);
      context.moveTo(0, position);
      context.lineTo(size, position);
    }
    context.stroke();
  }

  // Square root so a single crowded cell does not wash every other cell out.
  private getDensityColor(count: number): string {
    const level = Math.sqrt(count / (this.maxIntensity || 1)) * (DENSITY_STOPS.length - 1);
    const index = Math.min(DENSITY_STOPS.length - 2, Math.floor(level));
    const t = level - index;
    const [from, to] = [DENSITY_STOPS[index], DENSITY_STOPS[index + 1]];
    const channel = (c: number): number => Math.round(from[c] + (to[c] - from[c]) * t);
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
  }

  private async loadAlliances(alliance: string | string[]): Promise<ApiCartoAlliance[][] | null> {
    const lookups = Array.isArray(alliance)
      ? alliance.map(
          (id) => (): Promise<ApiResponse<ApiCartoAlliance[]>> =>
            this.apiRestService.getCartoAlliance(Number(id), this.selectedWorld),
        )
      : [
          Number.isNaN(Number.parseInt(alliance))
            ? (): Promise<ApiResponse<ApiCartoAlliance[]>> =>
                this.apiRestService.getCartoAllianceByName(alliance, this.selectedWorld)
            : (): Promise<ApiResponse<ApiCartoAlliance[]>> =>
                this.apiRestService.getCartoAlliance(Number(alliance), this.selectedWorld),
        ];

    const alliances: ApiCartoAlliance[][] = [];
    for (const lookup of lookups) {
      const response = await lookup();
      if (!response.success || response.data.length === 0) return null;
      alliances.push(response.data);
    }
    return alliances;
  }

  private applyLegendColors(parsedColors: string[] | null): void {
    if (!parsedColors) return;
    for (const [index, legend] of this.legends.entries()) {
      if (parsedColors[index]) this.changeItemColor(legend.name, parsedColors[index]);
    }
  }
}
