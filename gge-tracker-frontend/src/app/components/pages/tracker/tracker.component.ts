import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchbarComponent } from '@ggetracker-components/searchbar/searchbar.component';
import { SelectComponent } from '@ggetracker-components/select/select.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { ApiDungeonsResponse, Dungeon, ErrorType } from '@ggetracker-interfaces/empire-ranking';
import { CooldownPipe } from '@ggetracker-pipes/cooldown.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { ServerService } from '@ggetracker-services/server.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, MessageCircleQuestion, Search, X } from 'lucide-angular';

interface Realm {
  key: number;
  label: string;
}

@Component({
  selector: 'app-tracker',
  standalone: true,
  imports: [
    NgClass,
    TableComponent,
    LucideAngularModule,
    SearchbarComponent,
    SelectComponent,
    NgIf,
    NgFor,
    TranslateModule,
    CooldownPipe,
    FormsModule,
    NgSelectModule,
  ],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent extends GenericComponent {
  public serverService = inject(ServerService);
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
  public states = {
    Tous: 0,
    Attaquable: 1,
    'Bientôt attaquable (< 5min)': 2,
    'Bientôt attaquable (< 1h)': 3,
  };
  public displayedStates: { label: string; value: string }[] = [];
  public realms: Realm[] = [
    { key: 2, label: 'Le Glacier éternel' },
    { key: 1, label: 'Les Sables brûlants' },
    { key: 3, label: 'Les Pics du feu' },
  ];
  public selectedRealm: number[] = [2];
  public filterByKid: number[] = [2];
  public allowedServers = ['FR1', 'RO1', 'IT1', 'CZ1', 'SA1', 'DE1', 'NL1'];
  private localStorage = inject(LocalStorageService);

  constructor() {
    super();
    this.isInLoading = true;
    this.resetHeaders();
    this.init();
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
    if (this.headers.length === 4) {
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
    if (this.headers.length === 4) {
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

  public onRealmChange(realmId: { key: number; label: string }[]): void {
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
    const realm = this.realms.find((r) => r.key === kid);
    return realm ? realm.label : 'Inconnu';
  }

  public isInCooldown(dungeon: Dungeon): boolean {
    if (dungeon.cooldown === 0) return false;
    const updatedDate = new Date(dungeon.updatedAt);
    const endTime = new Date(updatedDate.getTime() + dungeon.cooldown * 1000);
    const now = new Date();
    return endTime.getTime() > now.getTime();
  }

  public onStateChange(state: keyof typeof this.states): void {
    this.selectedState = state;
    this.filterByAttackCooldown = this.states[state];
    this.localStorage.setItem('selectedState', state);
    this.page = 1;
    void this.getData();
  }

  private async getData(): Promise<void> {
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
      this.displayedStates = Object.entries(this.states).map(this.mapStateEntry);
      this.displayedStates.forEach((state) => {
        state.label = this.translateService.instant(state.label);
      });
      this.activeSortCount = 0;
      this.page = 1;
      const realm = this.localStorage.getItem('selectedRealm');
      if (realm) {
        try {
          this.selectedRealm = JSON.parse(realm) as number[];
          if (!Array.isArray(this.selectedRealm) || this.selectedRealm.length === 0) {
            this.selectedRealm = [2];
          }
        } catch {
          this.selectedRealm = [2];
        }
      }
      if (this.localStorage.getItem('selectedState')) {
        this.selectedState = this.localStorage.getItem('selectedState') as keyof typeof this.states;
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
    const choosedServer = this.serverService.choosedServer;
    if (choosedServer === null || !this.serverService.servers.includes(choosedServer)) {
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
      return {
        rank: rankFunction(index),
        playerName: dungeon.player_name,
        playerId: dungeon.player_id,
        cooldown: dungeon.attack_cooldown,
        image: this.getDungeonImage(dungeon.kid),
        kid: dungeon.kid,
        position: `[${dungeon.position_x}, ${dungeon.position_y}]`,
        totalAttackCount: dungeon.total_attack_count,
        updatedAt: dungeon.updated_at,
        effectiveCooldownUntil: dungeon.effective_cooldown_until,
        lastAttackAt: dungeon.last_attack,
        distance: dungeon.distance,
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

  private resetHeaders(): void {
    this.headers = [
      ['kid', 'Royaume', '', true],
      ['position', 'Position', '', true],
      ['state', 'Etat', '', true],
      ['playerName', 'Attaqué par', '', true],
    ];
  }
}
