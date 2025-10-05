import { NgClass, NgFor, NgIf, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import type * as Leaflet from 'leaflet';
import { combineLatest } from 'rxjs';

import {
  WorldSizeDimensions,
  CastleType,
  Castle,
  CastleQuantity,
  Monument,
  WatchModeStats,
  ApiCartoAlliance,
  ApiCartoMap,
  ApiResponse,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ServerService } from '@ggetracker-services/server.service';
import { WindowService } from '@ggetracker-services/window.service';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { ServerBadgeComponent } from '@ggetracker-components/server-badge/server-badge.component';

@Component({
  selector: 'app-server-cartography',
  standalone: true,
  imports: [
    NgFor,
    NgClass,
    RouterLink,
    NgIf,
    FormatNumberPipe,
    NgTemplateOutlet,
    FormsModule,
    TranslateModule,
    ServerBadgeComponent,
    SearchFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './server-cartography.component.html',
  styleUrl: './server-cartography.component.css',
})
export class ServerCartographyComponent extends GenericComponent implements AfterViewInit {
  @ViewChild('searchForm') public searchForm!: SearchFormComponent;
  @ViewChild('heatmapCanvas', { static: true })
  public canvasRef!: ElementRef<HTMLCanvasElement>;
  public map!: L.Map;
  public heatmapLayer: L.LayerGroup | null = null;
  public showUnallied = false;
  public maxIntensity = 0;
  public cellSize = 10;
  public resolution = 20;
  public downloadLoading = false;
  public heatmap: { pp: number; players: string[] }[][] = [];
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
  public legends: { name: string; color: string }[] = [];
  public castles: Castle[] = [];
  public nbPlayers = 0;
  public searchedAlliance = '';
  public monumentsList: Monument[] = [];
  public pageSize = 10;
  public currentPage = 1;
  public totalPages = 1;
  public searchTerm = '';
  public sortColumn: keyof Monument | null = null;
  public sortAsc = true;
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
    { name: 'Le Grand Empire', id: 0, icon: 'assets/dungeon0.png' },
    { name: 'Le Glacier éternel', id: 2, icon: 'assets/dungeon2.png' },
    { name: 'Les Sables brûlants', id: 1, icon: 'assets/dungeon1.png' },
    { name: 'Les Pics du feu', id: 3, icon: 'assets/dungeon3.png' },
    { name: 'Les Îles orageuses', id: 4, icon: 'assets/dungeon4.png' },
  ];
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

  private readonly MIN_RADIUS = 2;
  private readonly MAX_RADIUS = 30;
  private alliances: ApiCartoMap[] = [];
  private toggledAllianceCastles: string[] = [];
  private L!: typeof Leaflet;
  private cdr = inject(ChangeDetectorRef);
  private windowService = inject(WindowService);
  private serverService = inject(ServerService);
  private allianceName: string | null = null;
  private filteredCastles: Castle[] = [];
  private playerLayers: Record<string, L.LayerGroup> = {};
  private selectedPolylines: L.Polyline[] = [];
  private containerSize: number = WorldSizeDimensions.X.MAX;
  private selectedPlayer: string | null = null;

  public async ngAfterViewInit(): Promise<void> {
    if (this.isBrowser) {
      const leafletModule = await import('leaflet');
      this.L = leafletModule.default ?? leafletModule;
      this.initMap();
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
    combineLatest([this.route.queryParamMap, this.route.paramMap]).subscribe(([queryParams, routeParams]) => {
      const size = parseInt(queryParams.get('size') || '');
      const world = parseInt(queryParams.get('world') || '0');
      const paramIn = queryParams.get('in');
      const colors = queryParams.get('c');
      const alliance = routeParams.get('alliance');
      const server = queryParams.get('srv') || this.serverService.currentServer;
      if (server !== this.serverService.currentServer) {
        this.serverService.changeServer(server);
      }
      this.selectedWorld = world;
      this.initMap();
      if (size !== null && !isNaN(size)) {
        void this.initWithAlliances(size);
      } else if (alliance) {
        if (alliance === 'custom' && paramIn) {
          try {
            const parsedParam = JSON.parse(decodeURIComponent(paramIn));
            let parsedColors = [];
            try {
              parsedColors = JSON.parse(decodeURIComponent(colors || '[]') || '[]');
            } catch {
              /* empty */
            }
            void this.initWithSpecificAlliance(parsedParam, WatchModeStats.ALL_ALLIANCES, parsedColors);
          } catch {
            this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
            return;
          }
        } else {
          this.allianceName = alliance;
          void this.initWithSpecificAlliance(alliance);
        }
      }
    });
  }

  public onMouseMove(event: MouseEvent): void {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const canvasWidth = this.canvasRef.nativeElement.width;
    const canvasHeight = this.canvasRef.nativeElement.height;
    const rows = this.heatmap.length;
    const cols = this.heatmap[0]?.length || 0;
    if (rows === 0 || cols === 0) return;
    const cellWidth = canvasWidth / cols;
    const cellHeight = canvasHeight / rows;
    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);
    if (this.heatmap[row] && this.heatmap[row][col]) {
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
  public showCellDetails(
    row: number,
    col: number,
    cell: { pp: number; players: string[] },
    event: MouseEvent | FocusEvent,
  ): void {
    const win = this.windowService.getWindow();
    if (!win) return;
    const mouseEvent = event as MouseEvent;
    const x = col * this.resolution;
    const y = row * this.resolution;
    this.tooltipData = {
      coords: `${x}; ${y}`,
      pp: cell.pp,
      players: cell.players,
    };
    if (mouseEvent.pageX + 10 + 200 > win.innerWidth - 200) {
      this.tooltipX = mouseEvent.pageX - 200;
    } else {
      this.tooltipX = mouseEvent.pageX + 10;
    }
    if (mouseEvent.pageY + 10 + 100 > win.innerHeight - 200) {
      this.tooltipY = mouseEvent.pageY - 100;
    } else {
      this.tooltipY = mouseEvent.pageY + 10;
    }
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
      this.addHeatmapLayer(this.filteredCastles);
      this.setMonuments();
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
        const param = 'allianceId=' + this.route.snapshot.params['allianceId'];
        const url: ApiResponse<Blob> = await this.apiRestService.getScreenshot(param);
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
        const param = 'size=' + this.alliancesQuantity;
        const url: ApiResponse<Blob> = await this.apiRestService.getScreenshot(param);
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

  public isPlayerHidden(player: string): boolean {
    if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE) {
      return !this.filteredCastles.find((entry) => entry.name === player);
    } else {
      return !this.filteredCastles.find((entry) => entry.alliance_name === player);
    }
  }

  public generateHeatmap(): void {
    const numCells: number = Math.ceil(this.containerSize / this.resolution);
    this.heatmap = Array.from({ length: numCells }, () =>
      Array.from({ length: numCells }, () => ({ pp: 0, players: [] })),
    );
    const players = this.filteredCastles;
    const t = this.translateService;
    players.forEach((player) => {
      player.castles.forEach(([x, y, _]) => {
        if (_ === CastleType.LABORATORY || _ === CastleType.MONUMENT || _ === CastleType.ROYAL_TOWER) return;
        const row = Math.floor(y / this.resolution);
        const col = Math.floor(x / this.resolution);
        if (this.heatmap[row] && this.heatmap[row][col] !== undefined) {
          const nbCastles = player.castles.filter(
            (castle) =>
              castle[2] !== CastleType.MONUMENT &&
              castle[2] !== CastleType.LABORATORY &&
              castle[2] !== CastleType.ROYAL_TOWER,
          ).length;
          const pp = player.pp / nbCastles;
          this.heatmap[row][col].pp += pp;
          this.heatmap[row][col].players.push(player.name + ' (' + t.instant(this.getCastleType(_)) + ')');
        }
      });
    });
    this.maxIntensity = Math.max(...this.heatmap.flat().map((cell) => cell.players.length));
    this.clearHeatMap();
    this.drawHeatmap();
  }

  public searchAlliance(): void {
    if (!this.isBrowser) return;
    window.location.href = '/map/' + this.searchedAlliance;
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
    this.toggledAllianceCastles = this.toggledAllianceCastles.filter((name) => name !== allianceOrPlayerName);
    const deepCopyCastles = JSON.parse(JSON.stringify(castles));
    this.initMap();
    this.castles = deepCopyCastles;
    this.filteredCastles = this.getFilteredCastles(this.castles);
    this.addHeatmapLayer(this.filteredCastles);
    this.setMonuments();
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
    const uniqueCastleIds = Array.from(new Set(castleIds));
    const inParam = JSON.stringify(uniqueCastleIds);
    const colors = JSON.stringify(this.legends.map((legend) => this.rgbToHex(legend.color)));
    const world = this.selectedWorld || 0;
    const srv = this.serverService.currentServer;
    const link = `/map/custom?s=${srv}&world=${world}&in=${encodeURIComponent(inParam)}&c=${encodeURIComponent(colors)}`;
    if (link.length > 2000) {
      // If the link is too long, we show an error message (this is a limitation of the URL length)
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    // Copy the link to the clipboard
    window.navigator.clipboard
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
      // Alliance "1" is the unallied players, not the name of the alliance.
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
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 50000);
      this.isInLoading = false;
      this.cdr.detectChanges();
      return;
    } else {
      this.toastService.add(ErrorType.ALLIANCE_ADDED, 5000, 'info');
      this.searchForm.search = '';
      this.searchForm.searchFixed = '';
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
    const deepCopyCastles = JSON.parse(JSON.stringify(this.castles));
    this.initMap();
    this.castles = deepCopyCastles;
    this.filteredCastles = this.getFilteredCastles(this.castles);
    this.addHeatmapLayer(this.filteredCastles);
    this.setMonuments();
    this.generateHeatmap();
    setTimeout(() => {
      this.genericInit();
      this.isInLoading = false;
      this.cdr.detectChanges();
    }, 10);
  }

  public toggleAllianceCastles(allianceName: string): void {
    if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE) return;
    const playerLayer = this.playerLayers[allianceName];
    if (!playerLayer) return;
    if (this.map.hasLayer(playerLayer)) {
      this.map.removeLayer(playerLayer);
      this.filteredCastles = this.filteredCastles.filter((entry) => entry.alliance_name !== allianceName);
      this.toggledAllianceCastles.push(allianceName);
    } else {
      playerLayer.addTo(this.map);
      const originalAlliance = this.getFilteredCastles(
        this.castles.filter((entry) => entry.alliance_name === allianceName),
      );
      this.toggledAllianceCastles = this.toggledAllianceCastles.filter((name) => name !== allianceName);

      this.filteredCastles.push(...originalAlliance);
    }
    this.addHeatmapLayer(this.filteredCastles);
    const activeAlliances = Object.keys(this.playerLayers).filter((name) =>
      this.filteredCastles.some((player) => player.alliance_name === name),
    );
    activeAlliances.forEach((name) => {
      const layer = this.playerLayers[name];
      this.map.removeLayer(layer);
      layer.addTo(this.map);
    });
    this.clearHeatMap();
    this.generateHeatmap();
    this.cdr.detectChanges();
  }

  public togglePlayerCastle(playerName: string): void {
    const playerLayer = this.playerLayers[playerName];
    if (!playerLayer) return;
    if (this.map.hasLayer(playerLayer)) {
      this.map.removeLayer(playerLayer);
      this.filteredCastles = this.filteredCastles.filter((entry) => entry.name !== playerName);
    } else {
      playerLayer.addTo(this.map);
      const originalPlayer = this.castles.find((entry) => entry.name === playerName);
      if (originalPlayer) this.filteredCastles.push(originalPlayer);
    }
    this.addHeatmapLayer(this.filteredCastles);
    const activeLayers = Object.keys(this.playerLayers).filter((name) =>
      this.filteredCastles.some((player) => player.name === name),
    );
    activeLayers.forEach((name) => {
      const layer = this.playerLayers[name];
      this.map.removeLayer(layer);
      layer.addTo(this.map);
    });
  }

  public getDensityColor(intensity: number): string {
    if (intensity === 0) return 'rgba(50, 255, 50,.1)';
    const normalized = intensity / (this.maxIntensity || 1);
    const r = 255;
    const g = Math.min(255, Math.floor(255 - normalized * 255));
    const b = Math.min(255, Math.floor(255 - normalized * 255));
    const a = Math.min(1, normalized + 0.2);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  public getHeatmapColor(value: number): string {
    const r = 0;
    const g = Math.min(255, Math.floor(255 - value * 255));
    const b = Math.min(255, Math.floor(255 - value * 128));
    return `rgba(${r},${g},${b},.1)`;
  }

  public changeItemColor(allianceOrPlayerName: string, eventTarget: EventTarget | null | string): void {
    const color = typeof eventTarget === 'string' ? eventTarget : (eventTarget as HTMLInputElement).value;
    this.legends = this.legends.map((legend) => {
      if (legend.name === allianceOrPlayerName) {
        return { ...legend, color: this.hexToRgb(color) };
      }
      return legend;
    });
    if (this.playerLayers[allianceOrPlayerName]) {
      this.playerLayers[allianceOrPlayerName].eachLayer((layer: L.Layer | L.LayerGroup) => {
        if (layer instanceof this.L.LayerGroup) {
          layer.eachLayer((subLayer: L.Layer) => {
            if (subLayer instanceof this.L.Circle || subLayer instanceof this.L.Rectangle) {
              subLayer.setStyle({
                color: '#000',
                fillColor: this.hexToRgb(color),
              });
            } else if (subLayer instanceof this.L.Polygon || subLayer instanceof this.L.Polyline) {
              subLayer.setStyle({ color: this.hexToRgb(color) });
            }
          });
        } else if (layer instanceof this.L.Circle || layer instanceof this.L.Rectangle) {
          layer.setStyle({ color: '#000', fillColor: this.hexToRgb(color) });
        } else if (layer instanceof this.L.Polygon || layer instanceof this.L.Polyline) {
          layer.setStyle({ color: this.hexToRgb(color) });
        }
      });
    }
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
          const hex = parseInt(x, 10).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('')
    );
  }

  public changePage(delta: number): void {
    this.currentPage = Math.min(this.totalPages, Math.max(1, this.currentPage + delta));
  }

  public onSearchChange(): void {
    this.currentPage = 1;
  }

  public sortBy(column: keyof Monument): void {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }
  }

  public hexToRgb(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return 'rgb(0, 0, 0)';
    return `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})`;
  }

  public applyFilters(): void {
    const castles = JSON.parse(JSON.stringify(this.castles));
    this.initMap();
    this.castles = castles;
    this.filteredCastles = this.getFilteredCastles(this.castles);
    this.setMonuments();
    setTimeout(() => {
      this.genericInit();
      this.cdr.detectChanges();
    }, 100);
    this.addHeatmapLayer(this.filteredCastles);
  }

  private getFilteredCastles(castle: Castle[]): Castle[] {
    return castle.map((castle: Castle) => {
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
    this.plotCastles();
    this.nbPlayers = this.castles.length;
    this.isInLoading = false;
  }

  private async initWithSpecificAlliance(
    alliance: string | string[],
    watchMode = WatchModeStats.SPECIFIC_ALLIANCE,
    parsedColors: string[] | null = null,
  ): Promise<void> {
    this.watchModeAlliance = watchMode;
    const alliances: ApiCartoAlliance[][] = [];
    // We check if the alliance is a number or a string
    if (typeof alliance === 'string' && !isNaN(parseInt(alliance))) {
      const el = await this.apiRestService.getCartoAlliance(Number(alliance), this.selectedWorld);
      if (el.success && el.data.length > 0) {
        alliances.push(el.data);
      } else {
        this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
        return;
      }
    } else if (Array.isArray(alliance)) {
      for (const id of alliance) {
        const res = await this.apiRestService.getCartoAlliance(Number(id), this.selectedWorld);
        if (res.success && res.data.length > 0) {
          alliances.push(res.data);
        } else {
          this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
          return;
        }
      }
    } else {
      const el = await this.apiRestService.getCartoAllianceByName(alliance, this.selectedWorld);
      if (el.success && el.data.length > 0) {
        alliances.push(el.data);
      } else {
        this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
        return;
      }
    }
    const castles: Castle[] = [];
    alliances.forEach((alliance: ApiCartoAlliance[]) => {
      castles.push(...this.mapCastleFromData(alliance));
    });
    this.castles = castles.filter((entry) => entry.castles && entry.castles.length > 0);
    this.filteredCastles = this.castles;
    this.setMonuments();
    this.generateHeatmap();
    setTimeout(() => {
      this.genericInit();
      if (parsedColors) {
        for (let i = 0; i < this.legends.length; i++) {
          if (parsedColors[i]) {
            this.changeItemColor(this.legends[i].name, parsedColors[i]);
          }
        }
      }
      this.cdr.detectChanges();
    }, 100);
    this.addHeatmapLayer(this.castles);
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
    this.heatmapLayer = null;
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
    this.addHeatmapLayer(this.castles);
    this.setMonuments();
    this.generateHeatmap();
    this.genericInit();
    this.cdr.detectChanges();
  }

  private addAlliances(alliances: ApiCartoMap[]): void {
    alliances.forEach((alliance: ApiCartoMap) => {
      if (!this.alliances.find((a) => a.name === alliance.name)) {
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
    const res = data.map((entry) => {
      const castles = entry.castles ? entry.castles : [];
      const realmCastles = entry.castles_realm ? entry.castles_realm : [];
      let selectedCastles: [number, number, number][] = [];
      if (this.selectedWorld !== 0) {
        selectedCastles = realmCastles
          .filter((castle: number[]) => castle[0] === this.selectedWorld)
          .map((castle: number[]) => [castle[1], castle[2], castle[3]]);
      } else {
        selectedCastles = castles;
      }
      return {
        name: entry.name,
        castles: selectedCastles,
        pp: entry.might_current,
        alliance_id: 'alliance_id' in entry ? entry.alliance_id : undefined,
        alliance_name: 'alliance_name' in entry ? entry.alliance_name : undefined,
      };
    });
    return res;
  }

  /**
   * This function is used to set the background of the map.
   * It is used to set the background of the map to a rectangle with a specific color and weight.
   * We also bind a click event to the rectangle to highlight the castles of the player.
   * @returns {void}
   */
  private initRectangle(): void {
    const fillColor = this.getBackgroundColor();
    this.L.rectangle(
      [
        [WorldSizeDimensions.X.MIN, WorldSizeDimensions.Y.MIN],
        [WorldSizeDimensions.X.MAX, WorldSizeDimensions.Y.MAX],
      ],
      { color: '#000000', weight: 2, fillColor: fillColor, fillOpacity: 0.3 },
    )
      .on('click', () => this.highlightPlayerCastles(null))
      .addTo(this.map);
  }

  private getBackgroundColor(): string {
    const colors = ['green', '#E3D191', '#F3F2F2', '#46362A', '#0E98B9'];
    return colors[(this.selectedWorld === undefined ? 0 : this.selectedWorld) % colors.length];
  }

  /**
   * Default function to initialize the map.
   * This function is used to set the center of the map and the zoom level.
   * It is also used to set the max bounds of the map.
   * We also set the attribution control to false to avoid showing the Leaflet attribution.
   * @returns {void}
   */
  private initMap(): void {
    const boundSize = 100;
    if (!this.map) {
      this.map = this.L.map('map', {
        center: [WorldSizeDimensions.X.MAX / 2, WorldSizeDimensions.Y.MAX / 2],
        zoom: -1,
        minZoom: -1,
        maxZoom: 3,
        attributionControl: false,
        maxBounds: [
          [WorldSizeDimensions.X.MIN - boundSize, WorldSizeDimensions.Y.MIN - boundSize],
          [WorldSizeDimensions.X.MAX + boundSize, WorldSizeDimensions.X.MAX + boundSize],
        ],
        crs: this.L.CRS.Simple,
      });
    } else {
      this.clearAllProperties();
      this.clearLayers();
    }
    this.initRectangle();
  }

  private formatXCord(x: number): number {
    return WorldSizeDimensions.X.MAX - x;
  }

  private addLegend(): void {
    this.legends = [];
    if (this.watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE) {
      this.castles.forEach((player) => {
        this.legends.push({
          name: player.name,
          color: this.getPlayerColor(player.name),
        });
      });
      this.legends.sort((a, b) => {
        const bPlayer = this.castles.find((player) => player.name === b.name);
        const aPlayer = this.castles.find((player) => player.name === a.name);
        const bPp = bPlayer?.pp ?? 0;
        const aPp = aPlayer?.pp ?? 0;
        return bPp - aPp;
      });
    } else {
      const uniqueAlliances = this.castles
        .reduce(
          (
            unique: {
              key: string;
              alliance_id: number;
              alliance_name: string;
            }[],
            castle,
          ) => {
            if (castle.alliance_name) {
              const id = castle.alliance_id || 1;
              const key = `${id}-${castle.alliance_name}`;

              if (!unique.some((alliance) => alliance.key === key)) {
                unique.push({
                  key,
                  alliance_id: id,
                  alliance_name: castle.alliance_name,
                });
              }
            }
            return unique;
          },
          [],
        )
        .map((alliance) => ({
          alliance_id: alliance.alliance_id,
          alliance_name: alliance.alliance_name,
        }));
      this.legends = uniqueAlliances.map((alliance) => ({
        name: alliance.alliance_name,
        color: this.getPlayerColor(alliance.alliance_name),
      }));

      this.loadedAlliancesQuantity = uniqueAlliances.length;
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
          case CastleType.CASTLE:
            this.quantity.castle++;
            break;
          case CastleType.REALM_CASTLE:
            this.quantity.castle++;
            break;
          case CastleType.OUTPOST:
            this.quantity.outpost++;
            break;
          case CastleType.MONUMENT:
            this.quantity.monument++;
            this.quantity.patriarch++;
            break;
          case CastleType.LABORATORY:
            this.quantity.laboratory++;
            this.quantity.patriarch++;
            break;
          case CastleType.CAPITAL:
            this.quantity.capital++;
            this.quantity.patriarch++;
            break;
          case CastleType.ROYAL_TOWER:
            this.quantity.royalTower++;
            this.quantity.patriarch++;
            break;
          case CastleType.CITY:
            this.quantity.city++;
            this.quantity.patriarch++;
            break;
          default:
            break;
        }
      });
    });
  }

  private generateShape(
    castleType: CastleType,
    x: number,
    y: number,
    radius: number,
    compactRadius: number,
    color: string,
  ): L.Polygon | L.Circle | L.Rectangle {
    let shape: L.Polygon | L.Circle | L.Rectangle;
    if (castleType === CastleType.OUTPOST) {
      shape = this.L.rectangle(
        [
          [y - compactRadius, x - compactRadius],
          [y + compactRadius, x + compactRadius],
        ],
        {
          color: '#3b3b3b',
          fillColor: color,
          weight: 1,
          fillOpacity: 0.5,
        },
      );
    } else if (castleType === CastleType.CASTLE || castleType === CastleType.REALM_CASTLE) {
      // fillOpacity is calculated based on the radius
      const fillOpacity = 0.9 - ((radius - this.MIN_RADIUS) / (this.MAX_RADIUS - this.MIN_RADIUS)) * 0.5;
      shape = this.L.circle([y, x], {
        color: 'black',
        fillColor: color,
        fillOpacity: fillOpacity,
        weight: 1,
        radius,
      });
    } else {
      if (castleType === CastleType.MONUMENT || castleType === CastleType.LABORATORY) {
        compactRadius = 2;
      } else if (castleType === CastleType.ROYAL_TOWER) {
        compactRadius = 6;
      } else {
        compactRadius *= 1.5;
        if ((castleType === CastleType.CAPITAL || castleType === CastleType.CITY) && compactRadius < 6) {
          compactRadius = 6;
        }
        if (compactRadius < 2) compactRadius = 2;
      }
      shape = this.L.polygon(
        [
          [y - compactRadius, x],
          [y - compactRadius / 2, x + (compactRadius * Math.sqrt(3)) / 2],
          [y + compactRadius / 2, x + (compactRadius * Math.sqrt(3)) / 2],
          [y + compactRadius, x],
          [y + compactRadius / 2, x - (compactRadius * Math.sqrt(3)) / 2],
          [y - compactRadius / 2, x - (compactRadius * Math.sqrt(3)) / 2],
        ],
        {
          color: color,
          fillColor: 'white',
          fillOpacity: 0.8,
          weight: 1,
        },
      );
    }
    return shape;
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
    let tooltip = `<b>${player.name}</b><br>${mp}: ${this.formatPp(player.pp)}<br>${type}: ${this.translateService.instant(castleType)}`;
    if (this.watchModeAlliance === WatchModeStats.ALL_ALLIANCES) {
      tooltip += `<br>${alliance}: ${player.alliance_name}`;
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
    const players = this.filteredCastles;
    const watchModeAlliance = this.watchModeAlliance;
    const one = watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE;
    this.addLegend();
    const colors: Record<string, string> = {};
    const minPp = Math.min(...players.map((player) => player.pp));
    const maxPp = Math.max(...players.map((player) => player.pp));
    const list = players.length > 3000 ? players.reverse() : players;
    list.forEach((player: Castle) => {
      let color: string;
      if (one) {
        color = this.getPlayerColor(player.name);
      } else {
        if (player.alliance_name !== undefined) {
          if (!colors[player.alliance_name]) colors[player.alliance_name] = this.getPlayerColor(player.alliance_name);
          color = colors[player.alliance_name];
        }
      }
      const playerLayer = this.L.layerGroup();
      player.castles.forEach((castle: number[]) => {
        const [x, y] = [castle[0], this.formatXCord(castle[1])];
        const radius = this.getCircleRadius(player.pp, minPp, maxPp);
        const castleType = this.getCastleType(castle[2]);
        const shape = this.generateShape(castle[2], x, y, radius, 0.5 * radius, color);
        const tooltip = this.generateTooltip(player, x, 1286 - y, castleType);
        shape.bindTooltip(tooltip, { permanent: false }).on('click', () => this.highlightPlayerCastles(player));
        playerLayer.addLayer(shape);
      });
      if (watchModeAlliance === WatchModeStats.SPECIFIC_ALLIANCE) {
        playerLayer.addTo(this.map);
        this.playerLayers[player.name] = playerLayer;
      } else {
        if (player.alliance_name) {
          if (this.playerLayers[player.alliance_name]) {
            this.playerLayers[player.alliance_name].addLayer(playerLayer);
          } else {
            const allianceLayer = this.L.layerGroup();
            allianceLayer.addLayer(playerLayer);
            allianceLayer.addTo(this.map);
            this.playerLayers[player.alliance_name] = allianceLayer;
          }
        }
      }
    });
    this.fillQuantity();
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
      this.map.setView([643, 643], 0);
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
          color: this.getPlayerColor(player.name),
          weight: 2,
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

  private addHeatmapLayer(players: Castle[]): void {
    if (this.heatmapLayer) {
      this.map.removeLayer(this.heatmapLayer);
    }
    const heatmapPoints: { x: number; y: number; intensity: number }[] = [];
    players.forEach((player) => {
      player.castles.forEach((castle: number[]) => {
        if (
          castle[2] === CastleType.CASTLE ||
          castle[2] === CastleType.REALM_CASTLE ||
          castle[2] === CastleType.OUTPOST ||
          castle[2] === CastleType.CAPITAL ||
          castle[2] === CastleType.CITY
        ) {
          heatmapPoints.push({
            x: castle[0],
            y: WorldSizeDimensions.Y.MAX - castle[1],
            intensity: player.pp,
          });
        }
      });
    });
    this.heatmapLayer = this.L.layerGroup();
    const heatmap = this.heatmapLayer;
    if (!heatmap) return;
    const maxPp = Math.max(...this.filteredCastles.map((player) => player.pp));
    heatmapPoints.forEach((point) => {
      const intensityNormalized = point.intensity / maxPp;
      const color = this.getHeatmapColor(intensityNormalized);
      const radius = Math.sqrt(intensityNormalized) * 50;
      this.L.circle([point.y, point.x], {
        radius,
        color,
        fillOpacity: 0.6,
        opacity: 0,
      }).addTo(heatmap);
    });
    heatmap.addTo(this.map);
  }

  /**
   * This function is used to fill the monuments list.
   * It is used to show the monument list.
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
            color: this.getPlayerColor(entry.name),
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
    if (pp < 1000000) return (pp / 1000).toFixed(2) + 'K';
    if (pp < 1000000000) return (pp / 1000000).toFixed(2) + 'M';
    return (pp / 1000000000).toFixed(2) + 'B';
  }

  /**
   * This function is used to get the player color.
   * It is used to generate a color based on the player name.
   * This is useful to avoid having the same color for different players.
   * @param name The name of the player
   * @returns {string} The color of the player
   */
  private getPlayerColor(name: string): string {
    if (name === '1') return '#000000';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    // We use bitwise operations to generate a color based on the hash
    const r = (hash >> 16) & 255;
    const g = (hash >> 8) & 255;
    const b = hash & 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * This function is used to get the circle radius of a castle.
   * It is used to generate a circle with a specific radius based on the Might Points (PP) of the player.
   * @param pp The Might Points of the castle
   * @param minPp The minimum Might Points of all players (used to normalize the radius)
   * @param maxPp The maximum Might Points of all players (used to normalize the radius)
   * @returns {number} The radius of the circle
   */
  private getCircleRadius(pp: number, minPp: number, maxPp: number): number {
    return this.MIN_RADIUS + ((pp - minPp) / (maxPp - minPp)) * (this.MAX_RADIUS - this.MIN_RADIUS);
  }

  private clearHeatMap(): void {
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvasRef.nativeElement.width, this.canvasRef.nativeElement.height);
  }

  private drawHeatmap(): void {
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;
    const canvasWidth = this.canvasRef.nativeElement.width;
    const canvasHeight = this.canvasRef.nativeElement.height;
    const rows = this.heatmap.length;
    const cols = this.heatmap[0]?.length || 0;
    if (rows === 0 || cols === 0) return;
    const cellWidth = canvasWidth / cols;
    const cellHeight = canvasHeight / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        ctx.fillStyle = this.getDensityColor(this.heatmap[row][col].players.length);
        ctx.fillRect(col * cellWidth, row * cellHeight, cellWidth, cellHeight);
      }
    }
  }

  public get paginatedMonuments(): Monument[] {
    let filtered = this.monumentsList;

    if (this.searchTerm.trim()) {
      const lower = this.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.type.toLowerCase().includes(lower) ||
          m.position.toLowerCase().includes(lower) ||
          m.owner.toLowerCase().includes(lower),
      );
    }
    const sortColum = this.sortColumn;
    if (sortColum) {
      filtered = [...filtered].sort((a, b) => {
        const aValue = a[sortColum] ?? '';
        const bValue = b[sortColum] ?? '';
        return (
          ('' + aValue).localeCompare('' + bValue, undefined, {
            sensitivity: 'base',
          }) * (this.sortAsc ? 1 : -1)
        );
      });
    }

    this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize;
    return filtered.slice(start, start + this.pageSize);
  }
}
