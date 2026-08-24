import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { SearchbarComponent } from '@ggetracker-components/searchbar/searchbar.component';
import { SelectComponent } from '@ggetracker-components/select/select.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiStormFortsResponse,
  ApiStormIslesResponse,
  ApiStormMetaResponse,
  ErrorType,
  StormFort,
  StormIsle,
  StormIsleState,
} from '@ggetracker-interfaces/empire-ranking';
import {
  getStormFortDefinition,
  getStormIsleDefinition,
  getStormIsleImage,
  getStormResourceLabel,
  resolveFortIsleIds,
  resolveIsleIsleIds,
  STORM_FORT_IMAGE,
  STORM_FORT_LEVELS,
  STORM_RESOURCES,
  StormFortDefinition,
  StormIsleDefinition,
  StormResource,
} from '../../../definitions/storm-isles.definition';
import { CooldownPipe } from '@ggetracker-pipes/cooldown.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, MessageCircleQuestion, Search, X } from 'lucide-angular';

/** A fort row joined with its in-game configuration */
interface StormFortRow extends StormFort {
  definition: StormFortDefinition | null;
  image: string;
}

/** An isle row joined with its in-game configuration */
interface StormIsleRow extends StormIsle {
  definition: StormIsleDefinition | null;
  image: string;
}

@Component({
  selector: 'app-storm-tracker',
  imports: [
    NgClass,
    TableComponent,
    LucideAngularModule,
    SearchbarComponent,
    SelectComponent,
    TranslateModule,
    CooldownPipe,
    FormsModule,
    DatePipe,
    DecimalPipe,
    ModalFormGroupComponent,
  ],
  standalone: true,
  templateUrl: './storm-tracker.component.html',
  styleUrl: './storm-tracker.component.css',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class StormTrackerComponent extends GenericComponent {
  public serverService = inject(ServerService);
  public readonly Search = Search;
  public readonly X = X;
  public readonly MessageCircleQuestionMark = MessageCircleQuestion;
  public readonly StormIsleState = StormIsleState;
  public readonly stormFortImage = STORM_FORT_IMAGE;
  public readonly getStormIsleImage = getStormIsleImage;
  public readonly getStormResourceLabel = getStormResourceLabel;
  public readonly maxVictories = 10;

  public activeTab: 'forts' | 'isles' = 'forts';
  public forts: StormFortRow[] = [];
  public isles: StormIsleRow[] = [];
  public stormMeta: ApiStormMetaResponse | null = null;

  public headers: [string, string, string, boolean][] = [];
  public pageSize = 15;
  public page = 1;
  public maxPage: number | null = null;
  public resultsCount = 0;
  public responseTime = 0;
  public refreshDataAnimationSpinner = false;
  public activeSortCount = 0;

  public fortStates = {
    Tous: 0,
    Attaquable: 1,
    'Bientôt attaquable (< 5min)': 2,
    'Bientôt attaquable (< 1h)': 3,
  };
  public isleStates = {
    Tous: 0,
    Libre: 1,
    Occupée: 2,
    'En réapparition': 3,
  };
  public displayedStates: { label: string; value: string }[] = [];

  public readonly fortLevels = STORM_FORT_LEVELS;
  public readonly resources = STORM_RESOURCES;
  public readonly fortSorts: { label: string; value: string }[] = [
    { label: 'Les plus pertinentes', value: '' },
    { label: 'Distance', value: 'distance' },
    { label: 'Disponibilité', value: 'availability' },
    { label: 'Attaques restantes', value: 'attacksLeft' },
    { label: 'Position', value: 'position' },
  ];
  public readonly isleSorts: { label: string; value: string }[] = [
    { label: 'Les plus pertinentes', value: '' },
    { label: 'Distance', value: 'distance' },
    { label: 'Disponibilité', value: 'availability' },
    { label: 'Position', value: 'position' },
  ];

  public filterByAvailability: number | null = null;
  public filterByState: number | null = null;
  public minAttacksLeft: number | null = null;
  public selectedLevels: number[] = [];
  public lowGarrisonOnly = false;
  public selectedResources: StormResource[] = [];
  public orderBy = '';
  public orderDirection: 'asc' | 'desc' = 'asc';
  public filterByOccupierName: string | null = null;
  public positionX: number | null = null;
  public positionY: number | null = null;
  public nearPlayerName: string | null = null;
  public maxDistance: number | null = null;

  private localStorage = inject(LocalStorageService);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
    this.isInLoading = true;
    this.init();
    this.resetHeaders();
    try {
      void this.getMeta();
      void this.getData();
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }

  public get allowedServers(): string[] {
    return this.serverService.xmlServers.filter((s) => s.featured).map((s) => s.name);
  }

  public isInCooldown(item: StormFortRow | StormIsleRow): boolean {
    return new Date(item.availableAt) > new Date();
  }

  public isSunk(fort: StormFortRow): boolean {
    return fort.attacksLeft <= 0;
  }

  public switchTab(tab: 'forts' | 'isles'): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.page = 1;
    this.localStorage.setItem('stormActiveTab', tab);
    this.resetHeaders();
    this.displayedStates = this.buildDisplayedStates();
    void this.getData();
  }

  public buildDisplayedStates(): { label: string; value: string }[] {
    const states = this.activeTab === 'forts' ? this.fortStates : this.isleStates;
    return Object.entries(states).map(([label, value]) => ({
      label: this.translateService.instant(label),
      value: String(value),
    }));
  }

  public changeState(input: string | null): void {
    const states = this.activeTab === 'forts' ? this.fortStates : this.isleStates;
    const target = Object.entries(states).find(([, value]) => String(value) === input);
    if (!target) return;
    const value = target[1] === 0 ? null : target[1];
    if (this.activeTab === 'forts') {
      this.filterByAvailability = value;
      this.localStorage.setItem('stormFortState', String(target[1]));
    } else {
      this.filterByState = value;
      this.localStorage.setItem('stormIsleState', String(target[1]));
    }
    this.page = 1;
    void this.getData();
  }

  public onLevelsChange(levels: number[]): void {
    this.selectedLevels = levels;
    this.localStorage.setItem('stormLevels', JSON.stringify(levels));
    this.page = 1;
    void this.getData();
  }

  public toggleLevel(level: number): void {
    this.onLevelsChange(
      this.selectedLevels.includes(level)
        ? this.selectedLevels.filter((selected) => selected !== level)
        : [...this.selectedLevels, level],
    );
  }

  public toggleResource(resource: StormResource): void {
    this.onResourcesChange(
      this.selectedResources.includes(resource)
        ? this.selectedResources.filter((selected) => selected !== resource)
        : [...this.selectedResources, resource],
    );
  }

  public toggleLowGarrisonOnly(): void {
    this.lowGarrisonOnly = !this.lowGarrisonOnly;
    this.localStorage.setItem('stormLowGarrison', String(this.lowGarrisonOnly));
    this.page = 1;
    void this.getData();
  }

  public onResourcesChange(resources: StormResource[]): void {
    this.selectedResources = resources;
    this.localStorage.setItem('stormResources', JSON.stringify(resources));
    this.page = 1;
    void this.getData();
  }

  public changeSort(value: string | null): void {
    this.orderBy = value ?? '';
    this.localStorage.setItem('stormOrderBy', this.orderBy);
    this.page = 1;
    void this.getData();
  }

  public toggleSortDirection(): void {
    this.orderDirection = this.orderDirection === 'asc' ? 'desc' : 'asc';
    this.localStorage.setItem('stormOrderDirection', this.orderDirection);
    this.page = 1;
    void this.getData();
  }

  public resetFilters(): void {
    if (this.activeTab === 'forts') {
      this.filterByAvailability = null;
      this.selectedLevels = [];
      this.lowGarrisonOnly = false;
      this.minAttacksLeft = null;
      this.localStorage.removeItem('stormFortState');
      this.localStorage.removeItem('stormLevels');
      this.localStorage.removeItem('stormLowGarrison');
    } else {
      this.filterByState = null;
      this.selectedResources = [];
      this.filterByOccupierName = null;
      this.localStorage.removeItem('stormIsleState');
      this.localStorage.removeItem('stormResources');
    }
    this.page = 1;
    void this.getData();
  }

  public onMinAttacksLeftChange(value: number | null): void {
    if (value !== null && (value < 0 || value > this.maxVictories)) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.minAttacksLeft = value;
    this.page = 1;
    void this.getData();
  }

  public resetMinAttacksLeft(): void {
    this.minAttacksLeft = null;
    this.page = 1;
    void this.getData();
  }

  public onOccupierNameChange(playerName: string): void {
    this.isInLoading = true;
    this.filterByOccupierName = playerName;
    this.page = 1;
    void this.getData();
  }

  public resetOccupierName(): void {
    this.filterByOccupierName = null;
    this.page = 1;
    void this.getData();
  }

  public onPositionChange(positionX: number | null, positionY: number | null): void {
    if (positionX === null || positionY === null) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    if (positionX < 0 || positionY < 0 || positionX > 1286 || positionY > 1286) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.positionX = positionX;
    this.positionY = positionY;
    this.nearPlayerName = null;
    this.localStorage.removeItem('stormNearPlayerName');
    this.localStorage.setItem('stormPositionX', String(positionX));
    this.localStorage.setItem('stormPositionY', String(positionY));
    this.applyDistanceSortState();
  }

  public onPositionChangePlayerName(playerName: string | null): void {
    if (playerName === null) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.positionX = null;
    this.positionY = null;
    this.localStorage.removeItem('stormPositionX');
    this.localStorage.removeItem('stormPositionY');
    this.nearPlayerName = playerName;
    this.localStorage.setItem('stormNearPlayerName', playerName);
    this.applyDistanceSortState();
  }

  public onMaxDistanceChange(maxDistance: number | null): void {
    if (maxDistance !== null && maxDistance <= 0) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.maxDistance = maxDistance;
    if (maxDistance === null) {
      this.localStorage.removeItem('stormMaxDistance');
    } else {
      this.localStorage.setItem('stormMaxDistance', String(maxDistance));
    }
    this.page = 1;
    void this.getData();
  }

  public resetPosition(): void {
    this.positionX = null;
    this.positionY = null;
    this.nearPlayerName = null;
    this.maxDistance = null;
    this.localStorage.removeItem('stormPositionX');
    this.localStorage.removeItem('stormPositionY');
    this.localStorage.removeItem('stormNearPlayerName');
    this.localStorage.removeItem('stormMaxDistance');
    this.activeSortCount = 0;
    this.page = 1;
    this.resetHeaders();
    void this.getData();
  }

  public onPageSizeChange(pageSize: number): void {
    this.pageSize = pageSize;
    this.localStorage.setItem('stormPageSize', String(pageSize));
    this.page = 1;
    void this.getData();
  }

  public resetPageSize(): void {
    this.pageSize = 15;
    this.localStorage.removeItem('stormPageSize');
    this.page = 1;
    void this.getData();
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.page = page;
    await this.getData();
  }

  public async nextPage(): Promise<void> {
    if (this.isInLoading) return;
    this.page++;
    await this.getData();
  }

  public async previousPage(): Promise<void> {
    if (this.isInLoading) return;
    this.page--;
    await this.getData();
  }

  public refresh(): void {
    this.isInLoading = true;
    this.refreshDataAnimationSpinner = true;
    void this.getData();
  }

  public getIsleStateLabel(state: StormIsleState): string {
    switch (state) {
      case StormIsleState.FREE: {
        return 'Libre';
      }
      case StormIsleState.OCCUPIED: {
        return 'Occupée';
      }
      default: {
        return 'En réapparition';
      }
    }
  }

  private applyDistanceSortState(): void {
    this.activeSortCount = 1;
    if (!this.headers.some(([key]) => key === 'distance')) {
      this.headers.splice(2, 0, ['distance', 'Distance', '', true]);
    }
    this.page = 1;
    void this.getData();
  }

  private init(): void {
    try {
      const storedTab = this.localStorage.getItem('stormActiveTab');
      if (storedTab === 'forts' || storedTab === 'isles') this.activeTab = storedTab;

      const storedFortState = this.localStorage.getItem('stormFortState');
      if (storedFortState) this.filterByAvailability = Number(storedFortState) || null;

      const storedIsleState = this.localStorage.getItem('stormIsleState');
      if (storedIsleState) this.filterByState = Number(storedIsleState) || null;

      if (this.localStorage.getItem('stormPageSize')) {
        this.pageSize = Number.parseInt(this.localStorage.getItem('stormPageSize') as string);
      }
      if (this.localStorage.getItem('stormPositionX')) {
        this.positionX = Number.parseInt(this.localStorage.getItem('stormPositionX') as string);
      }
      if (this.localStorage.getItem('stormPositionY')) {
        this.positionY = Number.parseInt(this.localStorage.getItem('stormPositionY') as string);
      }
      if (this.localStorage.getItem('stormNearPlayerName')) {
        this.nearPlayerName = this.localStorage.getItem('stormNearPlayerName');
      }
      if (this.localStorage.getItem('stormMaxDistance')) {
        this.maxDistance = Number.parseInt(this.localStorage.getItem('stormMaxDistance') as string);
      }
      this.selectedLevels = this.readStoredArray('stormLevels', (v) => this.fortLevels.includes(Number(v))).map(Number);
      this.selectedResources = this.readStoredArray('stormResources', (v) =>
        (this.resources as string[]).includes(String(v)),
      ) as StormResource[];
      this.lowGarrisonOnly = this.localStorage.getItem('stormLowGarrison') === 'true';
      this.orderBy = this.localStorage.getItem('stormOrderBy') ?? '';
      this.orderDirection = this.localStorage.getItem('stormOrderDirection') === 'desc' ? 'desc' : 'asc';
      if ((this.positionX !== null && this.positionY !== null) || this.nearPlayerName !== null) {
        this.headers.splice(2, 0, ['distance', 'Distance', '', true]);
        this.activeSortCount = 1;
      }
      this.displayedStates = this.buildDisplayedStates();
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }

  private readStoredArray(key: string, isValid: (value: unknown) => boolean): unknown[] {
    const raw = this.localStorage.getItem(key);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((element) => isValid(element)) : [];
    } catch {
      return [];
    }
  }

  private async getMeta(): Promise<void> {
    const response = await this.apiRestService.getStormMeta();
    this.stormMeta = response.success ? response.data : null;
    this.cdr.markForCheck();
  }

  private async getData(): Promise<void> {
    if (this.serverService.currentServer && !this.allowedServers.includes(this.serverService.currentServer.name)) {
      this.isInLoading = false;
      return;
    }
    this.isInLoading = true;
    try {
      await (this.activeTab === 'forts' ? this.loadForts() : this.loadIsles());
      void this.getMeta();
    } catch (error) {
      // The API answers "Player not found" both for an unknown name and for a player who has not
      // entered the Storm Islands this month, and "Invalid player name" for a malformed one
      const message = error instanceof Error ? error.message : String(error);
      const isPlayerError = message === 'Player not found' || message === 'Invalid player name';
      this.toastService.add(isPlayerError ? ErrorType.NO_PLAYER_FOUND : ErrorType.ERROR_OCCURRED, 5000);
    } finally {
      this.isInLoading = false;
      this.refreshDataAnimationSpinner = false;
      this.cdr.markForCheck();
    }
  }

  private async loadForts(): Promise<void> {
    const result = await this.apiRestService.getGenericData(
      this.apiRestService.getStormFortsList.bind(this.apiRestService),
      this.page,
      this.pageSize,
      this.filterByAvailability,
      this.minAttacksLeft,
      this.positionX,
      this.positionY,
      this.nearPlayerName,
      this.maxDistance,
      resolveFortIsleIds(this.selectedLevels, this.lowGarrisonOnly),
      this.orderBy || null,
      this.orderDirection,
    );
    this.responseTime = result.response;
    this.applyPagination(result.data);
    this.forts = this.mapFortsFromApi(result.data);
  }

  private async loadIsles(): Promise<void> {
    const result = await this.apiRestService.getGenericData(
      this.apiRestService.getStormIslesList.bind(this.apiRestService),
      this.page,
      this.pageSize,
      this.filterByState,
      this.filterByOccupierName,
      this.positionX,
      this.positionY,
      this.nearPlayerName,
      this.maxDistance,
      resolveIsleIsleIds(this.selectedResources),
      this.orderBy || null,
      this.orderDirection,
    );
    this.responseTime = result.response;
    this.applyPagination(result.data);
    this.isles = this.mapIslesFromApi(result.data);
  }

  private applyPagination(data: ApiStormFortsResponse | ApiStormIslesResponse): void {
    this.resultsCount = data.pagination?.total_items_count ?? 0;
    this.maxPage = data.pagination?.total_pages ?? 1;
  }

  private mapFortsFromApi(data: ApiStormFortsResponse): StormFortRow[] {
    const offset = (this.page - 1) * this.pageSize;
    return data.forts.map((fort, index) => ({
      rank: offset + index + 1,
      position: `[${fort.position_x}, ${fort.position_y}]`,
      positionX: fort.position_x,
      positionY: fort.position_y,
      isleId: fort.isle_id,
      victoryCount: fort.victory_count,
      attacksLeft: fort.attacks_left,
      isVisible: fort.is_visible,
      availableAt: fort.available_at,
      updatedAt: fort.updated_at,
      distance: fort.distance,
      effectiveCooldownUntil: fort.available_at,
      definition: getStormFortDefinition(fort.isle_id),
      image: STORM_FORT_IMAGE,
    }));
  }

  private mapIslesFromApi(data: ApiStormIslesResponse): StormIsleRow[] {
    const offset = (this.page - 1) * this.pageSize;
    return data.isles.map((isle, index) => ({
      rank: offset + index + 1,
      position: `[${isle.position_x}, ${isle.position_y}]`,
      positionX: isle.position_x,
      positionY: isle.position_y,
      objectId: isle.object_id,
      isleId: isle.isle_id,
      state: isle.state as StormIsleState,
      occupierId: isle.occupier_id,
      occupierName: isle.occupier_name,
      occupierMight: isle.occupier_might,
      occupierLevel: isle.occupier_level,
      occupierLegendaryLevel: isle.occupier_legendary_level,
      occupierAllianceName: isle.occupier_alliance_name,
      availableAt: isle.available_at,
      updatedAt: isle.updated_at,
      distance: isle.distance,
      effectiveCooldownUntil: isle.available_at,
      definition: getStormIsleDefinition(isle.isle_id),
      image: getStormIsleImage(isle.isle_id),
    }));
  }

  public get activeFilterCount(): number {
    let count = 0;
    if (this.activeTab === 'forts') {
      if (this.filterByAvailability !== null) count++;
      if (this.selectedLevels.length > 0) count++;
      if (this.lowGarrisonOnly) count++;
      if (this.minAttacksLeft !== null) count++;
    } else {
      if (this.filterByState !== null) count++;
      if (this.selectedResources.length > 0) count++;
      if (this.filterByOccupierName) count++;
    }
    return count;
  }

  public get isDistanceShown(): boolean {
    return (this.positionX !== null && this.positionY !== null) || this.nearPlayerName !== null;
  }

  private resetHeaders(): void {
    this.headers =
      this.activeTab === 'forts'
        ? [
            ['fort', 'Forteresse', '', true],
            ['position', 'Position', '', true],
            ['state', 'Etat', '', true],
            ['attacksLeft', 'Attaques restantes', '', true],
            ['units', 'Défenseurs', '', true],
          ]
        : [
            ['isle', 'Île', '', true],
            ['position', 'Position', '', true],
            ['state', 'Etat', '', true],
            ['occupierName', 'Occupant', '', true],
            ['loot', 'Butin', '', true],
          ];
    if (this.isDistanceShown) {
      this.headers.splice(2, 0, ['distance', 'Distance', '', true]);
    }
  }
}
