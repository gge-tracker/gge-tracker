import { DatePipe, NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchbarComponent } from '@ggetracker-components/searchbar/searchbar.component';
import { SelectComponent } from '@ggetracker-components/select/select.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { RealmMapLocateRequest } from '@ggetracker-components/realm-map/realm-map.models';
import { ServerUnavailableNoticeComponent } from '@ggetracker-components/server-unavailable-notice/server-unavailable-notice.component';
import { TrackerView, ViewSwitchComponent } from '@ggetracker-components/view-switch/view-switch.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import {
  ApiDungeonsMetaResponse,
  ApiDungeonsResponse,
  Dungeon,
  ErrorType,
  KingdomRealm,
} from '@ggetracker-interfaces/empire-ranking';
import { CooldownPipe } from '@ggetracker-pipes/cooldown.pipe';
import { DurationPipe } from '@ggetracker-pipes/duration.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, MessageCircleQuestion, Search, X } from 'lucide-angular';
import { DUNGEON_REALMS, DungeonMapComponent, DungeonMapFocus } from './dungeon-map/dungeon-map.component';
import {
  DungeonAttackHistoryComponent,
  DungeonLocation,
} from './dungeon-attack-history/dungeon-attack-history.component';
import Modal from 'bootstrap/js/dist/modal';
import { PunctuationPipe } from '@ggetracker-pipes/punctuation.pipe';

@Component({
  selector: 'app-tracker',
  imports: [
    ServerUnavailableNoticeComponent,
    PunctuationPipe,
    NgClass,
    TableComponent,
    LucideAngularModule,
    SearchbarComponent,
    SelectComponent,
    TranslateModule,
    CooldownPipe,
    DurationPipe,
    FormsModule,
    DatePipe,
    ModalFormGroupComponent,
    DungeonMapComponent,
    DungeonAttackHistoryComponent,
    ViewSwitchComponent,
  ],
  standalone: true,
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent extends GenericComponent {
  public realms: KingdomRealm[] = [
    { key: '2', label: 'Le Glacier éternel', translated: '' },
    { key: '1', label: 'Les Sables brûlants', translated: '' },
    { key: '3', label: 'Les Pics du feu', translated: '' },
  ];
  public serverService = inject(ServerService);
  public readonly dungeonRealms = DUNGEON_REALMS;
  public view: TrackerView = 'list';
  public mapRealmId = DUNGEON_REALMS[0].id;
  public mapFocus: DungeonMapFocus | null = null;
  public historyPlayerId: number | null = null;
  public selectedPlayerName: string | null = null;
  public readonly Search = Search;
  public readonly X = X;
  public readonly MessageCircleQuestionMark = MessageCircleQuestion;

  public pageSize = 15;
  public refreshDataAnimationSpinner = false;
  public selectedState: keyof typeof this.states = 'Tous';
  public activeSortCount = 0;
  public responseTime = 0;
  public resultsCount = 0;
  public maxPage: number | null = null;
  public page = 1;
  public headers: [string, string, string, boolean][] = [];
  public dungeons: Dungeon[] = [];
  public dungeonsMeta: ApiDungeonsMetaResponse | null = null;
  public filterByPlayerName: string | null = null;
  public filterByAttackCooldown: number | null = null;
  public positionX: number | null = null;
  public positionY: number | null = null;
  public nearPlayerName: string | null = null;
  public currentPage = 1;
  public totalPages = 1;
  public states = {
    Tous: 0,
    Attaquable: 1,
    'Bientôt attaquable (< 5min)': 2,
    'Bientôt attaquable (< 1h)': 3,
  };
  public displayedStates: { label: string; value: string }[] = [];
  public selectedRealm: string[] = ['2'];
  public filterByKid: string[] = ['2'];
  private readonly localStorage = inject(LocalStorageService);
  private isListStale = false;

  constructor() {
    super();
    this.isInLoading = true;
    this.updateHeaders();
    this.init();
  }

  public get showRealm(): boolean {
    return this.filterByKid.length !== 1;
  }

  public get showDistance(): boolean {
    return (this.positionX !== null && this.positionY !== null) || this.nearPlayerName !== null;
  }

  public get isServerAllowed(): boolean {
    return !this.serverService.currentServer || this.allowedServers.includes(this.serverService.currentServer.name);
  }

  public setView(view: TrackerView): void {
    this.view = view;
    this.localStorage.setItem('dungeonView', view);
    void this.updateGenericParamsInUrl({ view }, { view: 'list' });
    if (view === 'list' && this.isListStale) void this.getData();
  }

  public selectMapRealm(realmId: number): void {
    this.mapRealmId = realmId;
    this.localStorage.setItem('dungeonMapRealm', String(realmId));
  }

  public showOnMap(dungeon: Dungeon): void {
    this.locateOnMap({ kid: dungeon.kid, x: dungeon.positionX, y: dungeon.positionY });
  }

  public locateOnMap(location: DungeonLocation): void {
    this.mapRealmId = location.kid;
    this.mapFocus = {
      id: `${location.kid}:${location.x}:${location.y}`,
      kingdomId: location.kid,
      x: location.x,
      y: location.y,
    };
    this.setView('map');
  }

  public onMapOriginChange(request: RealmMapLocateRequest | null): void {
    if (request === null) {
      this.clearOrigin();
    } else if (request.kind === 'player') {
      this.onPositionChangePlayerName(request.name);
    } else {
      this.onPositionChange(request.x, request.y);
    }
  }

  public openAttackHistory(attacker: { playerId: string; playerName: string }): void {
    this.selectAttackHistoryPlayer(Number(attacker.playerId), attacker.playerName);
    const modal = document.querySelector('#dungeonHistoryModal');
    if (modal) Modal.getOrCreateInstance(modal).show();
  }

  public selectAttackHistoryPlayer(playerId: number | undefined, playerName: string | undefined): void {
    if (playerId === undefined) return;
    this.historyPlayerId = playerId;
    this.selectedPlayerName = playerName ?? '?';
  }

  public get allowedServers(): string[] {
    return this.serverService.xmlServers.filter((s) => s.fortress).map((s) => s.name);
  }

  public async nextPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page++;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const dungeons = data.data;
    this.dungeons = this.mapDungeonsFromApi(dungeons, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
  }

  public changeState(input: string | null): void {
    const targetItem = Object.entries(this.states)
      .map(this.mapStateEntry)
      .find((item) => item.value === input);
    if (targetItem) this.onStateChange(targetItem.label as keyof typeof this.states);
  }

  public async previousPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page--;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const dungeons = data.data;
    this.dungeons = this.mapDungeonsFromApi(dungeons, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page = page;
    const dungeons = await this.getGenericData();
    this.responseTime = dungeons.response;
    this.dungeons = this.mapDungeonsFromApi(
      dungeons.data,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
  }

  public resetPosition(): void {
    this.positionX = null;
    this.positionY = null;
    this.localStorage.removeItem('positionX');
    this.localStorage.removeItem('positionY');
    this.activeSortCount = 0;
    this.updateHeaders();
    this.page = 1;
    void this.getData();
  }

  public onPositionChangePlayerName(playerName: string | null): void {
    if (playerName === null) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.positionX = null;
    this.positionY = null;
    this.localStorage.removeItem('positionX');
    this.localStorage.removeItem('positionY');
    this.isInLoading = true;
    this.nearPlayerName = playerName;
    this.localStorage.setItem('nearPlayerName', playerName);
    this.activeSortCount = 1;
    this.updateHeaders();
    this.page = 1;
    void this.getData();
  }

  public resetPositionPlayerName(): void {
    this.nearPlayerName = null;
    this.localStorage.removeItem('nearPlayerName');
    this.page = 1;
    this.activeSortCount = 0;
    this.updateHeaders();
    void this.getData();
  }

  public onPositionChange(positionX: number | null, positionY: number | null): void {
    const outsideMap = positionX === null || positionY === null;
    const outsideBounds = !outsideMap && (positionX < 0 || positionY < 0 || positionX > 1286 || positionY > 1286);
    if (outsideMap || outsideBounds) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.positionX = positionX;
    this.positionY = positionY;
    this.nearPlayerName = null;
    this.localStorage.removeItem('nearPlayerName');
    this.localStorage.setItem('positionX', positionX.toString());
    this.localStorage.setItem('positionY', positionY.toString());
    this.activeSortCount = 1;
    this.updateHeaders();
    this.page = 1;
    void this.getData();
  }

  public resetPlayerName(): void {
    this.filterByPlayerName = null;
    this.localStorage.removeItem('playerName');
    this.page = 1;
    void this.getData();
  }

  public onPlayerNameChange(playerName: string): void {
    this.isInLoading = true;
    this.page = 1;
    this.filterByPlayerName = playerName;
    this.localStorage.setItem('playerName', playerName);
    void this.getData();
  }

  public isListRealmSelected(realmId: number): boolean {
    return this.selectedRealm.includes(realmId.toString());
  }

  public toggleListRealm(realmId: number): void {
    const key = realmId.toString();
    if (this.isListRealmSelected(realmId)) {
      if (this.selectedRealm.length === 1) return;
      this.selectedRealm = this.selectedRealm.filter((selected) => selected !== key);
    } else {
      this.selectedRealm = [...this.selectedRealm, key];
    }
    this.onRealmChange();
  }

  public onPageSizeChange(pageSize: number): void {
    this.pageSize = pageSize;
    this.localStorage.setItem('pageSize', pageSize.toString());
    this.page = 1;
    void this.getData();
  }

  public resetPageSize(): void {
    this.pageSize = 15;
    this.localStorage.removeItem('pageSize');
    this.page = 1;
    void this.getData();
  }

  public refresh(): void {
    this.isInLoading = true;
    this.refreshDataAnimationSpinner = true;
    void this.getData();
  }

  public getRealmName(kid: number): string {
    const realm = this.realms.find((r) => Number(r.key) === kid);
    return realm ? realm.label : 'Inconnu';
  }

  public isInCooldown(dungeon: Dungeon): boolean {
    if (!dungeon.effectiveCooldownUntil) return false;
    const now = new Date();
    const availableAt = new Date(dungeon.effectiveCooldownUntil);
    return availableAt > now;
  }

  public onStateChange(state: keyof typeof this.states): void {
    this.selectedState = state;
    this.filterByAttackCooldown = this.states[state];
    this.localStorage.setItem('selectedState', state);
    this.page = 1;
    void this.getData();
  }

  private clearOrigin(): void {
    this.positionX = null;
    this.positionY = null;
    this.nearPlayerName = null;
    this.localStorage.removeItem('positionX');
    this.localStorage.removeItem('positionY');
    this.localStorage.removeItem('nearPlayerName');
    this.activeSortCount = 0;
    this.updateHeaders();
    this.page = 1;
    void this.getData();
  }

  private async getMeta(): Promise<void> {
    const response = await this.apiRestService.getDungeonsMeta();
    this.dungeonsMeta = response.success ? response.data : null;
  }

  private async getData(): Promise<void> {
    if (this.serverService.currentServer && !this.allowedServers.includes(this.serverService.currentServer.name)) {
      this.isInLoading = false;
      return;
    }
    if (this.view === 'map') {
      this.isListStale = true;
      void this.getMeta().finally(() => (this.isInLoading = false));
      return;
    }
    this.isListStale = false;
    if (this.filterByKid.length === 0) {
      this.responseTime = 0;
      this.resultsCount = 0;
      this.maxPage = 0;
      this.dungeons = [];
      this.isInLoading = false;
      this.refreshDataAnimationSpinner = false;
      return;
    }
    void this.getMeta();
    this.getGenericData()
      .then((dungeons) => {
        this.responseTime = dungeons.response;
        this.resultsCount = dungeons.data.pagination.total_items_count;
        this.maxPage = dungeons.data.pagination.total_pages;
        this.dungeons = this.mapDungeonsFromApi(dungeons.data, (index: number) => index + 1);
        this.isInLoading = false;
        this.refreshDataAnimationSpinner = false;
      })
      .catch((error) => {
        if (error === 'Invalid player name') {
          this.toastService.add(ErrorType.NO_PLAYER_FOUND, 5000);
        } else {
          this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
        }
        this.isInLoading = false;
        this.refreshDataAnimationSpinner = false;
      });
  }

  private init(): void {
    try {
      this.realms.forEach((realm) => {
        realm.translated = this.translateService.instant(realm.label);
      });
      const requestedView = this.route.snapshot.queryParamMap.get('view') ?? this.localStorage.getItem('dungeonView');
      if (requestedView === 'map') this.view = 'map';
      const storedMapRealm = Number(this.localStorage.getItem('dungeonMapRealm'));
      if (DUNGEON_REALMS.some((realm) => realm.id === storedMapRealm)) this.mapRealmId = storedMapRealm;
      this.displayedStates = Object.entries(this.states).map(this.mapStateEntry);
      this.displayedStates.forEach((state) => {
        state.label = this.translateService.instant(state.label);
      });
      this.activeSortCount = 0;
      this.page = 1;
      const realm = this.localStorage.getItem('selectedRealm');
      if (realm) {
        try {
          this.selectedRealm = JSON.parse(realm) as string[];
          if (!Array.isArray(this.selectedRealm) || this.selectedRealm.length === 0) {
            this.selectedRealm = ['2'];
          }
          this.selectedRealm.forEach((r) => {
            if (!this.realms.some((realm) => realm.key === r)) {
              throw new Error('Invalid realm key');
            }
          });
          this.selectedRealm = this.selectedRealm.map(String);
        } catch {
          this.selectedRealm = ['2'];
        }
      }
      if (this.localStorage.getItem('selectedState')) {
        this.selectedState = this.localStorage.getItem('selectedState') as keyof typeof this.states;
        this.filterByAttackCooldown = this.states[this.selectedState];
      }
      if (this.localStorage.getItem('playerName')) {
        this.filterByPlayerName = this.localStorage.getItem('playerName');
      }
      if (this.localStorage.getItem('pageSize')) {
        this.pageSize = Number.parseInt(this.localStorage.getItem('pageSize') as string);
      }
      if (this.localStorage.getItem('positionX')) {
        this.positionX = Number.parseInt(this.localStorage.getItem('positionX') as string);
      }
      if (this.localStorage.getItem('positionY')) {
        this.positionY = Number.parseInt(this.localStorage.getItem('positionY') as string);
      }
      if (this.localStorage.getItem('nearPlayerName')) {
        this.nearPlayerName = this.localStorage.getItem('nearPlayerName');
      }
      if (this.showDistance) this.activeSortCount++;
      this.filterByKid = this.selectedRealm;
      this.updateHeaders();
      this.filterByAttackCooldown = this.states[this.selectedState];
      void this.getData();
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }

  private async getGenericData(): Promise<{
    data: ApiDungeonsResponse;
    response: number;
  }> {
    const currentServer = this.serverService.currentServer?.name;
    if (!currentServer || !this.serverService.servers.includes(currentServer)) {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      throw new Error('Server not found');
    }
    return await this.apiRestService.getGenericData(this.apiRestService.getDungeonsList.bind(this.apiRestService), {
      page: this.page,
      size: this.pageSize,
      filterByKid: JSON.stringify(this.filterByKid),
      filterByAttackCooldown: this.filterByAttackCooldown,
      filterByPlayerName: this.filterByPlayerName,
      positionX: this.positionX,
      positionY: this.positionY,
      nearPlayerName: this.nearPlayerName,
    });
  }

  private mapStateEntry([label, value]: [string, number]): { label: string; value: string } {
    return { label, value: String(value) };
  }

  private mapDungeonsFromApi(dungeons: ApiDungeonsResponse, rankFunction: (rank: number) => number): Dungeon[] {
    if (dungeons.pagination) {
      this.maxPage = dungeons.pagination.total_pages;
    } else {
      this.maxPage = 1;
    }
    return dungeons.dungeons.map((dungeon, index) => {
      const effectiveCooldownUntil = dungeon.effective_cooldown_until;
      const availableDurationSeconds = dungeon.available_duration_seconds;
      const now = Date.now();
      const cooldownEnd = effectiveCooldownUntil ? new Date(effectiveCooldownUntil).getTime() : null;
      const isAttackable = cooldownEnd !== null && cooldownEnd <= now;
      let availabilityAnimDelay: string | undefined;
      let availabilityExceeded: boolean | undefined;
      if (isAttackable && availableDurationSeconds && cooldownEnd !== null) {
        const rawElapsed = (now - cooldownEnd) / 1000;
        availabilityExceeded = rawElapsed >= availableDurationSeconds;
        const elapsed = Math.min(availableDurationSeconds, rawElapsed);
        availabilityAnimDelay = `-${elapsed}s`;
      }
      return {
        rank: rankFunction(index),
        playerId: dungeon.player_id,
        playerName: dungeon.player_name,
        image: this.getDungeonImage(dungeon.kid),
        lastAttackDate: dungeon.last_attack,
        kid: dungeon.kid,
        position: `[${dungeon.position_x}, ${dungeon.position_y}]`,
        positionX: dungeon.position_x,
        positionY: dungeon.position_y,
        globalAvailableAt: dungeon.global_available_at,
        effectiveCooldownUntil,
        availableDurationSeconds,
        distance: dungeon.distance,
        availabilityAnimDelay,
        availabilityExceeded,
      };
    });
  }

  private getDungeonImage(kid: number): string {
    switch (kid) {
      case 1: {
        return 'assets/dungeon1.png';
      }
      case 2: {
        return 'assets/dungeon2.png';
      }
      case 3: {
        return 'assets/dungeon3.png';
      }
      default: {
        return 'assets/dungeon_default.png';
      }
    }
  }

  private onRealmChange(): void {
    this.filterByKid = this.selectedRealm;
    this.updateHeaders();
    this.localStorage.setItem('selectedRealm', JSON.stringify(this.selectedRealm));
    this.page = 1;
    void this.getData();
  }

  private updateHeaders(): void {
    this.headers = [
      ...(this.showRealm ? [['kid', 'Royaume', '', true] as [string, string, string, boolean]] : []),
      ['position', 'Position', '', true],
      ...(this.showDistance ? [['distance', 'Distance', '', true] as [string, string, string, boolean]] : []),
      ['state', 'Etat', '', true],
      ['playerName', 'Attaqué par', '', true],
      ['availableDurationSeconds', 'Durée de disponibilité', '', true],
    ];
  }
}
