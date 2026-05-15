import { DatePipe, NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchbarComponent } from '@ggetracker-components/searchbar/searchbar.component';
import { SelectComponent } from '@ggetracker-components/select/select.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { ModalTableComponent } from '@ggetracker-components/modal-table/modal-table.component';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import {
  ApiDungeonsAttackHistory,
  ApiDungeonsResponse,
  ChartAdvancedOptions,
  Dungeon,
  ErrorType,
  KingdomRealm,
} from '@ggetracker-interfaces/empire-ranking';
import { CooldownPipe } from '@ggetracker-pipes/cooldown.pipe';
import { DurationPipe } from '@ggetracker-pipes/duration.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { ServerService } from '@ggetracker-services/server.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, MessageCircleQuestion, Search, X } from 'lucide-angular';

interface DungeonAttackHistory extends ApiDungeonsAttackHistory {
  image: string;
  id: string;
}

@Component({
  selector: 'app-tracker',
  imports: [
    NgClass,
    TableComponent,
    LucideAngularModule,
    SearchbarComponent,
    SelectComponent,
    TranslateModule,
    CooldownPipe,
    DurationPipe,
    FormsModule,
    NgSelectModule,
    DatePipe,
    ModalTableComponent,
    ModalFormGroupComponent,
    ChartsWrapperComponent,
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
  public playerDungeonAttackHistory: DungeonAttackHistory[] = [];
  public selectedPlayerName: string | null = null;
  public activeTab: 'list' | 'graph' = 'list';
  public attackChart: ChartAdvancedOptions | null = null;
  public attacksPerDayChart: ChartAdvancedOptions | null = null;
  public attackStats: { last24h: number; last7d: number; last30d: number } = { last24h: 0, last7d: 0, last30d: 0 };
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
  private localStorage = inject(LocalStorageService);

  constructor() {
    super();
    this.isInLoading = true;
    this.resetHeaders();
    this.init();
  }

  public async getDungeonsByPlayerId(dungeon: Dungeon): Promise<void> {
    const playerId = dungeon.playerId;
    if (playerId === undefined) return;
    this.isInLoading = true;
    this.activeTab = 'list';
    this.selectedPlayerName = dungeon.playerName ?? '?';
    await this.apiRestService.getDungeonsByPlayerId(playerId).then((response) => {
      if (!response.success) {
        this.isInLoading = false;
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
        return;
      }
      this.playerDungeonAttackHistory = response.data.dungeons.map((dungeon) => ({
        ...dungeon,
        image: this.getDungeonImage(dungeon.kid),
        id:
          dungeon.kid.toString() +
          '_' +
          dungeon.position_x.toString() +
          '_' +
          dungeon.position_y.toString() +
          '_' +
          dungeon.attacked_at,
      }));
      this.buildAttackChart(this.playerDungeonAttackHistory);
      this.isInLoading = false;
    });
  }

  public get allowedServers(): string[] {
    return this.serverService.xmlServers.filter((s) => s.featured).map((s) => s.name);
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
    this.resetHeaders();
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
    if (this.headers.length === 5) {
      this.headers.splice(2, 0, ['distance', 'Distance', '', true]);
    }
    this.page = 1;
    void this.getData();
  }

  public resetPositionPlayerName(): void {
    this.nearPlayerName = null;
    this.localStorage.removeItem('nearPlayerName');
    this.page = 1;
    this.activeSortCount = 0;
    this.resetHeaders();
    void this.getData();
  }

  public onPositionChange(positionX: number | null, positionY: number | null): void {
    if (positionX === null || positionY === null) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    } else if (positionX < 0 || positionY < 0 || positionX > 1286 || positionY > 1286) {
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
    if (this.headers.length === 5) {
      this.headers.splice(2, 0, ['distance', 'Distance', '', true]);
    }
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

  public onRealmChange(realmId: { key: string; label: string }[]): void {
    this.selectedRealm = realmId.map((r) => r.key);
    this.filterByKid = this.selectedRealm;
    this.localStorage.setItem('selectedRealm', JSON.stringify(this.selectedRealm));
    this.page = 1;
    void this.getData();
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

  public readonly dungeonHistorySearchFilter = (item: DungeonAttackHistory, term: string): boolean => {
    return (
      this.translateService.instant(this.getRealmName(item.kid)).toLowerCase().includes(term) ||
      `${item.position_x}:${item.position_y}`.includes(term) ||
      item.attacked_at.toLowerCase().includes(term)
    );
  };

  public onStateChange(state: keyof typeof this.states): void {
    this.selectedState = state;
    this.filterByAttackCooldown = this.states[state];
    this.localStorage.setItem('selectedState', state);
    this.page = 1;
    void this.getData();
  }

  private async getData(): Promise<void> {
    if (this.serverService.currentServer && !this.allowedServers.includes(this.serverService.currentServer.name)) {
      this.isInLoading = false;
      return;
    } else if (this.filterByKid.length === 0) {
      this.responseTime = 0;
      this.resultsCount = 0;
      this.maxPage = 0;
      this.dungeons = [];
      this.isInLoading = false;
      this.refreshDataAnimationSpinner = false;
      return;
    }
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
      if ((this.positionX !== null && this.positionY !== null) || this.nearPlayerName !== null) {
        this.headers.splice(2, 0, ['distance', 'Distance', '', true]);
        this.activeSortCount++;
      }
      this.filterByKid = this.selectedRealm;
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
    return await this.apiRestService.getGenericData(
      this.apiRestService.getDungeonsList.bind(this.apiRestService),
      this.page,
      this.pageSize,
      JSON.stringify(this.filterByKid),
      this.filterByAttackCooldown,
      this.filterByPlayerName,
      this.positionX,
      this.positionY,
      this.nearPlayerName,
    );
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
        globalAvailableAt: dungeon.global_available_at,
        effectiveCooldownUntil,
        availableDurationSeconds,
        distance: dungeon.distance,
        availabilityAnimDelay,
        availabilityExceeded,
      };
    });
  }

  private buildAttackChart(history: DungeonAttackHistory[]): void {
    if (history.length === 0) {
      this.attackChart = null;
      this.attacksPerDayChart = null;
      this.attackStats = { last24h: 0, last7d: 0, last30d: 0 };
      return;
    }

    const now = Date.now();
    const MS_24H = 24 * 3600 * 1000;
    const MS_7D = 7 * 24 * 3600 * 1000;
    const MS_30D = 30 * 24 * 3600 * 1000;
    this.attackStats = {
      last24h: history.filter((a) => now - new Date(a.attacked_at).getTime() <= MS_24H).length,
      last7d: history.filter((a) => now - new Date(a.attacked_at).getTime() <= MS_7D).length,
      last30d: history.filter((a) => now - new Date(a.attacked_at).getTime() <= MS_30D).length,
    };

    const sorted = [...history].sort((a, b) => new Date(a.attacked_at).getTime() - new Date(b.attacked_at).getTime());
    this.attackChart = {
      series: [
        {
          name: this.translateService.instant('Attaques cumulées'),
          data: sorted.map((attack, index) => ({ x: new Date(attack.attacked_at).getTime(), y: index + 1 })),
        },
      ],
      chart: {
        type: 'line',
        height: 260,
        animations: { enabled: false },
        toolbar: { show: false },
        zoom: { type: 'x', enabled: true },
      },
      stroke: { curve: 'stepline', width: 2 },
      xaxis: { type: 'datetime' },
      yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (v: number): string => Math.round(v).toString() } },
      colors: ['#0891b2'],
      markers: { size: 4 },
      tooltip: { x: { format: 'dd/MM/yy HH:mm:ss' } },
      grid: { borderColor: '#e2e8f0' },
    };

    const dayMap = new Map<string, number>();
    for (const attack of history) {
      const d = new Date(attack.attacked_at);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }
    const days = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    this.attacksPerDayChart = {
      series: [
        {
          name: this.translateService.instant('Attaques par jour'),
          data: days.map(([day, count]) => ({ x: new Date(`${day}T12:00:00`).getTime(), y: count })),
        },
      ],
      chart: { type: 'bar', height: 220, animations: { enabled: false }, toolbar: { show: false } },
      xaxis: { type: 'datetime', labels: { format: 'dd/MM' } },
      yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (v: number): string => Math.round(v).toString() } },
      plotOptions: { bar: { columnWidth: '60%', borderRadius: 3 } },
      colors: ['#059669'],
      dataLabels: { enabled: false },
      tooltip: { x: { format: 'dd/MM/yyyy' } },
      grid: { borderColor: '#e2e8f0' },
    };
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

  private resetHeaders(): void {
    this.headers = [
      ['kid', 'Royaume', '', true],
      ['position', 'Position', '', true],
      ['state', 'Etat', '', true],
      ['playerName', 'Attaqué par', '', true],
      ['availableDurationSeconds', 'Durée de disponibilité', '', true],
    ];
  }
}
