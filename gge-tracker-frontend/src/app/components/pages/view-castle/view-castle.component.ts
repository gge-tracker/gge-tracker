import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { DecimalPipe, NgClass, NgFor, NgIf, NgStyle } from '@angular/common';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import {
  ApiPlayerCastleDataMapped,
  ApiPlayerCastleDataResponse,
  ApiPlayerCastleNameResponse,
  ApiResponse,
  CastleType,
  ConstructionItem,
  ErrorType,
  IMappedBuildingElement,
  IMappedBuildingUnknownDataElement,
} from '@ggetracker-interfaces/empire-ranking';
import { Castle, LucideAngularModule } from 'lucide-angular';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { BuildingImgComponent } from './app-building-img/app-building-img.component';
import { SearchbarComponent } from '@ggetracker-components/searchbar/searchbar.component';
import { FilterComponent } from '@ggetracker-components/filter/filter.component';
import { ServerBadgeComponent } from '@ggetracker-components/server-badge/server-badge.component';
import { LoadingComponent } from '@ggetracker-components/loading/loading.component';
import { SwitchComponent } from '@ggetracker-components/switch/switch.component';
import { ISelectItem, SelectComponent } from '@ggetracker-components/select/select.component';
import { IMappedBuildingWithGround, Pt, GenericTextIds } from '@ggetracker-interfaces/view-castle';
import { ServerService } from '@ggetracker-services/server.service';

@Component({
  selector: 'app-view-castle',
  standalone: true,
  imports: [
    NgIf,
    SearchFormComponent,
    TranslatePipe,
    NgFor,
    NgClass,
    DecimalPipe,
    LucideAngularModule,
    LoadingComponent,
    ServerBadgeComponent,
    FormsModule,
    BuildingImgComponent,
    SwitchComponent,
    NgStyle,
    SelectComponent,
    FilterComponent,
    SearchbarComponent,
    SearchbarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './view-castle.component.html',
  styleUrl: './view-castle.component.css',
})
export class ViewCastleComponent extends GenericComponent implements OnInit {
  /**
   * An array containing mapped building objects along with their associated ground information.
   * Each element represents a building and its corresponding ground data within the castle view.
   */
  public buildings: IMappedBuildingWithGround[] = [];
  /**
   * An array containing mapped building data along with their associated ground information.
   * Each element represents a building and its corresponding ground details within the castle view.
   */
  public grounds: IMappedBuildingWithGround[] = [];
  /**
   * Stores the previously selected building item with its ground mapping.
   *
   * This property is used to keep track of the last selected building in the view,
   * allowing for operations such as deselection or comparison with the currently selected item.
   *
   * @type {IMappedBuildingWithGround | null}
   * @see IMappedBuildingWithGround
   */
  public previousSelectedItem: IMappedBuildingWithGround | null = null;
  public buildingStyles: Record<string, Record<string, string>> = {};
  public allVisibleBuildings: IMappedBuildingWithGround[] = [];
  public visibleBuildings: IMappedBuildingWithGround[] = [];
  public selectedItem: IMappedBuildingWithGround | null = null;
  public currentActivatedEffects: string[] = [];
  public constructionTypes: ISelectItem[] = [];
  public loadItem = false;
  public loadItemPlaceholder = false;
  public countFilterActivated = 0;
  public apiPath = ApiRestService.apiUrl;
  public filters: {
    isInDistrict: boolean;
    hasMaxLevel: boolean;
    upgradable: boolean;
    burnable: boolean;
    minLevel: number | string | null;
    maxLevel: number | string | null;
    sellPriceMin: number | string | null;
    sellPriceMax: number | string | null;
    mightMin: number | string | null;
    mightMax: number | string | null;
    fireDamageMin: number | string | null;
    fireDamageMax: number | string | null;
    publicOrderMin: number | string | null;
    publicOrderMax: number | string | null;
    constructionType: string | null;
    constructionItemsSlot1: string | null;
    constructionItemsSlot2: string | null;
    constructionItemsSlot3: string | null;
  } = {
    minLevel: null,
    maxLevel: null,
    sellPriceMin: null,
    sellPriceMax: null,
    isInDistrict: false,
    mightMin: null,
    mightMax: null,
    constructionType: null,
    hasMaxLevel: false,
    upgradable: false,
    constructionItemsSlot1: null,
    constructionItemsSlot2: null,
    constructionItemsSlot3: null,
    burnable: false,
    fireDamageMin: null,
    fireDamageMax: null,
    publicOrderMin: null,
    publicOrderMax: null,
  };
  public readonly Castle = Castle;
  public cid: number | null = null;
  public equipments: { [key: string]: any }[] | null = null;
  public tooltip: { x: number; y: number; text: string } | null = null;
  public itemsInDistricts: Record<number, IMappedBuildingWithGround[]> = {};
  public searchTerm = '';
  public sortColumn: string | null = null;
  public sortAsc = true;
  public pageSize = 10;
  public currentPage = 1;
  public totalPages = 1;
  public castles: ApiPlayerCastleNameResponse[] = [];
  public constructionItems: { [key: string]: ConstructionItem[] } = {};
  public castleObject: ApiPlayerCastleDataMapped | null = null;
  public search = '';
  public canvasReady = false;
  public data = {
    playerName: '',
    castleName: '',
    castleType: '',
    positionX: 0,
    positionY: 0,
    level: '',
    sumOP: 0,
    sumMight: 0,
    placeOccupied: 0,
    placeNotOccupied: 0,
    nbFloors: 0,
    maxFloors: 20,
    nbFire: 0,
  };
  @ViewChild('mapCanvas', { static: false }) public canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChildren('miniMap') public miniMaps!: QueryList<ElementRef<HTMLCanvasElement>>;

  private readonly mapSize = 1286;
  private readonly miniSize = 50;
  private readonly itemsJsonUrl = 'assets/items';
  private languageJsonData?: { [key: string]: string | string[] };
  private effects: Record<string, any>[] = [];
  private effectTypes: Record<string, any>[] = [];
  private minX = 0;
  private minY = 0;
  private maxX = 0;
  private buildingsAssetMapped: Record<string, number[]> = {};
  private maxY = 0;
  private cellSize = 0;
  private offsetX = 0;
  private offsetY = 0;
  private translations = {
    Niveau: '',
    Oui: '',
    Tous: '',
    Non: '',
    Aucun: 'Aucun',
    Inconnu: '',
    'Ordre public': '',
    Brûlable: '',
    Destructible: '',
    Stockable: '',
    Puissance: '',
    Commentaires: '',
    Dimensions: '',
    'Prix de vente': '',
    'Espace dans le quartier': '',
    'Objets de construction': '',
  };
  private cdr = inject(ChangeDetectorRef);
  private serverService = inject(ServerService);

  constructor() {
    super();
  }

  public async ngOnInit(): Promise<void> {
    const cid = this.route.snapshot.queryParamMap.get('analysis');
    this.cid = cid ? +cid : null;
    const kid = this.route.snapshot.queryParamMap.get('kid');
    const search = this.route.snapshot.queryParamMap.get('search');
    await this.translateKeys();
    if (cid && !Number.isNaN(+cid)) {
      void this.fetchCastleData(+cid, +(kid || 0));
    } else if (search) {
      this.search = search;
      void this.searchPlayer(search);
    }
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  public onSearchChange(): void {
    this.currentPage = 1;
  }

  public updateCdr(): void {
    this.cdr.detectChanges();
  }

  public getSkinFromUniqueId(castleJsonData: any, uniqueId: string): any {
    const equipment = castleJsonData.equipments.find((equip: any) => equip.equipmentID === uniqueId) || null;
    if (equipment) {
      return castleJsonData.worldmapskins.find((skin: any) => skin.skinID === equipment.skinID) || null;
    }
    return null;
  }

  public async searchPlayer(playerName: string): Promise<void> {
    if (!playerName) return;
    this.clearAllParameters();
    this.loadItemPlaceholder = true;
    await this.router.navigate([], { queryParams: { search: playerName } });
    this.search = playerName;
    const castleJsonData = await this.fetchCastleJsonItems();
    const castleResponse = await this.getCastleData();
    if (!castleResponse.success) {
      console.error('Failed to fetch player data:', castleResponse);
      this.toastService.add(ErrorType.NO_PLAYER_FOUND, 5000, 'error');
      this.loadItemPlaceholder = false;
      this.cdr.detectChanges();
      return;
    }
    this.castles = castleResponse.data.map((castle) => ({
      ...castle,
      equipment: castle.equipmentUniqueIdSkin
        ? this.getSkinFromUniqueId(castleJsonData, String(castle.equipmentUniqueIdSkin))
        : null,
    }));
    this.isInLoading = false;
    this.cdr.detectChanges();
    this.drawMiniMaps();
    this.loadItemPlaceholder = false;
    this.cdr.detectChanges();
    return;
  }

  public formatValue(value: number | string | number | boolean | null): string {
    const regex = /\B(?=(\d{3})+(?!\d))/g;
    return Number.isInteger(value) && value !== null
      ? value.toString().replaceAll(regex, ',')
      : this.translations['Inconnu'];
  }

  public displayUnavailableCastleMessage(): void {
    const message = this.translateService.instant('server-not-available', { server: this.serverService.choosedServer });
    this.toastService.add(message, 15_000, 'error');
  }

  public async updateJsonImageDimension(entry: IMappedBuildingWithGround): Promise<void> {
    this.buildingsAssetMapped[entry.building.objectID] = [1, 1, 1, 1];
    const name = String(entry?.data?.['name']).trim().toLowerCase();
    const level = String(entry?.data?.['type']).trim().toLowerCase();
    const category = String(entry?.data?.['group']).trim().toLowerCase();
    const basePath = ApiRestService.apiUrl + '/assets/images/data/';
    const ressource = `${basePath}${name}${category}${level}`;
    const response = await fetch(`${ressource}.json`);
    if (!response.ok) {
      console.error('Failed to fetch building data:', response);
      return;
    }
    const json = await response.json();
    this.buildingsAssetMapped[entry.building.objectID] = [json[0], json[1], json[2], json[3]];
  }

  public getConstructionUrl(entry: ConstructionItem): string {
    const basePath = ApiRestService.apiUrl + 'assets/common/';
    const name = String(entry['name']).trim().toLowerCase();
    return `${basePath}constructionitem${name}.png`;
  }

  public getSpecialSkin(castleType: string, name: string): string {
    const basePath = ApiRestService.apiUrl + 'assets/common/';
    //outpostmapobjectspecialspringbell
    const cleanCastleType = castleType.toLowerCase().trim().replaceAll('\-_', '');
    const cleanName = name.toLowerCase().trim().replaceAll('\-_', '');
    return `${basePath}${cleanCastleType}mapobjectspecial${cleanName}.png`;
  }

  public getSearchCastleImg(castle: ApiPlayerCastleNameResponse, displayEquipment = false): string {
    const basePath = ApiRestService.apiUrl + 'assets/images/';
    let path, level, eqName;
    switch (castle.type) {
      case CastleType.REALM_CASTLE:
      case CastleType.CASTLE: {
        path = 'keepbuilding';
        level = castle.keepLevel;
        eqName = 'castlemapobject';
        break;
      }
      case CastleType.CAPITAL: {
        path = 'capitalmapobject';
        break;
      }
      case CastleType.CITY: {
        path = 'metropolmapobject';
        break;
      }
      case CastleType.OUTPOST: {
        path = 'outpostmapobject';
        level = castle.keepLevel;
        break;
      }
    }
    if (displayEquipment && castle.equipment) {
      const cleanName = castle.equipment?.name.toLowerCase().trim().replaceAll('\-_', '');
      const suffix = cleanName === 'sand' ? 'sand802icon' : cleanName;
      return `${basePath}${eqName ?? path}special${suffix}.png`;
    }
    return `${basePath}${path}${level ? `level${level}.png` : 'basic.png'}`;
  }

  public convertToCSV(data: {
    width: number;
    height: number;
    mask: number[][];
    buildings: { w: number; h: number; id: number; priority: number }[];
  }): string {
    const header = ['Width', 'Height', 'Mask', 'Buildings'];
    const rows = [[data.width, data.height, JSON.stringify(data.mask), JSON.stringify(data.buildings)]];
    return [header, ...rows].map((row) => row.join(',')).join('\n');
  }

  public async updateFilters(): Promise<void> {
    const defaultItems = this.allVisibleBuildings;
    const filters = this.filters;
    const filteredItems = defaultItems.filter((item) => {
      const { positionX, positionY, inDistrictID } = item.building;
      if (filters.isInDistrict === true && (positionX >= 0 || positionY >= 0 || !inDistrictID)) return false;
      if (filters.hasMaxLevel === true && item.data['upgradeWodID']) return false;
      if (filters.upgradable === true && !item.data['upgradeWodID']) return false;
      if (filters.burnable === true && item.data['burnable'] == 0) return false;
      if (filters.minLevel && Number(item.data['level']) < Number(filters.minLevel)) return false;
      if (filters.maxLevel && Number(item.data['level']) > Number(filters.maxLevel)) return false;
      if (filters.sellPriceMin && (!item.data['sellC1'] || Number(item.data['sellC1']) < Number(filters.sellPriceMin)))
        return false;
      if (filters.sellPriceMax && (!item.data['sellC1'] || Number(item.data['sellC1']) > Number(filters.sellPriceMax)))
        return false;
      if (filters.mightMin && Number(item.data['mightValue']) < Number(filters.mightMin)) return false;
      if (filters.mightMax && Number(item.data['mightValue']) > Number(filters.mightMax)) return false;
      if (filters.fireDamageMin && item.building['damageFactor'] * 100 < Number(filters.fireDamageMin)) return false;
      if (filters.fireDamageMax && item.building['damageFactor'] * 100 > Number(filters.fireDamageMax)) return false;
      if (filters.publicOrderMin && Number(item.data['publicOrder']) < Number(filters.publicOrderMin)) return false;
      if (filters.publicOrderMax && Number(item.data['publicOrder']) > Number(filters.publicOrderMax)) return false;
      if (filters.constructionType && item.data['buildingGroundType'] !== filters.constructionType) return false;
      if (
        filters.constructionItemsSlot1 &&
        ((filters.constructionItemsSlot1 === 'assigned' && !item.constructionItems[0]) ||
          (filters.constructionItemsSlot1 === 'unassigned' && item.constructionItems[0]))
      )
        return false;
      if (
        filters.constructionItemsSlot2 &&
        ((filters.constructionItemsSlot2 === 'assigned' && !item.constructionItems[1]) ||
          (filters.constructionItemsSlot2 === 'unassigned' && item.constructionItems[1]))
      )
        return false;
      if (
        filters.constructionItemsSlot3 &&
        ((filters.constructionItemsSlot3 === 'assigned' && !item.constructionItems[2]) ||
          (filters.constructionItemsSlot3 === 'unassigned' && item.constructionItems[2]))
      )
        return false;
      return true;
    });
    this.countFilterActivated = Object.values(filters).filter(
      (value) => value !== null && value !== undefined && value !== false,
    ).length;
    this.visibleBuildings = filteredItems;
    this.cdr.detectChanges();
  }

  public downloadCSV(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.append(link);
    link.click();
    link.remove();
  }

  public isBuildingDistrict(entry: IMappedBuildingWithGround): boolean {
    return entry.data['isDistrict'] === '1';
  }

  public getItemsInDistrict(entry: IMappedBuildingWithGround): IMappedBuildingWithGround[] {
    if (this.isBuildingDistrict(entry)) {
      const districtId = Number(entry.data['districtTypeID']);
      return this.itemsInDistricts[districtId] || [];
    }
    return [];
  }

  public getBuildingUrl(entry: IMappedBuildingWithGround): string {
    const name = String(entry?.data?.['name']).trim().toLowerCase();
    const level = String(entry?.data?.['type']).trim().toLowerCase();
    const category = String(entry?.data?.['group']).trim().toLowerCase();
    const basePath = ApiRestService.apiUrl + 'assets/images/';
    let ressource;
    const levelIntWithoutLevel = Number.parseInt(level.replace('level', ''), 10);
    if (category === 'gate' || name === 'castlewall' || category === 'tower') {
      ressource = `${basePath}castlewall.png?level=${levelIntWithoutLevel}&type=${category}&quality=${name}`;
    } else if (name === 'basic' || name === 'premium') {
      ressource = `${basePath}${name}${category}classic.png?level=${levelIntWithoutLevel}`;
    } else {
      ressource = `${basePath}${name}${category}${level}.png`;
    }
    if (entry.constructionItems[0]) {
      const split = ressource.split('level');
      const name = String(entry.constructionItems[0]['name']).trim().toLowerCase();
      ressource = `${split[0]}${name}.png`;
    }
    return `${ressource}`;
  }

  public parseEffects(effects: string | number | boolean | null): string {
    if (!effects || typeof effects !== 'string') return '-';
    try {
      const parsed = JSON.parse(effects);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed.join(', ') : '-';
    } catch {
      return '-';
    }
  }

  public getBuildingName(entry: IMappedBuildingWithGround): string {
    return this.getLangKey(
      String(entry?.data?.['name']),
      String(entry?.data?.['type']),
      String(entry?.data?.['group']),
    );
  }

  public getBuildingNameFromData(data: IMappedBuildingUnknownDataElement): string {
    return this.getLangKey(String(data?.['name']), String(data?.['type']), String(data?.['group']));
  }

  public capitalizeFirstLetter(value: string | number | boolean | null): string {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  public changePage(delta: number): void {
    this.currentPage = Math.min(this.totalPages, Math.max(1, this.currentPage + delta));
  }

  public sortBy(column: string): void {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }
  }

  public updateSelectedItem(item: IMappedBuildingWithGround, updatePreviousItem?: IMappedBuildingWithGround): void {
    if (updatePreviousItem) {
      this.previousSelectedItem = updatePreviousItem;
    } else {
      this.previousSelectedItem = null;
    }
    this.selectedItem = item;
    document.querySelector('#viewItemModal')?.scrollTo(0, 0);
    this.cdr.detectChanges();
  }

  public getDefaultBoxUrl(index: number, type = 'common'): string {
    return `/assets/ci/${this.getBaseNameTextId(String(index))}_${type}.png`;
  }

  /**
   * Adds an image to the canvas, at the center of the specified area.
   * @param ctx The canvas rendering context.
   * @param x The x-coordinate of the image.
   * @param y The y-coordinate of the image.
   * @param w The width of the image.
   * @param h The height of the image.
   * @param imgSrc The source URL of the image.
   */
  public addImgToCanvas(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    imgSource?: string,
  ): void {
    if (imgSource) {
      const img = new Image();
      img.src = imgSource;
      img.addEventListener('load', (): void => {
        context.drawImage(img, x + w / 2 - 16, y + h / 2 - 16, 30, 30);
      });
    }
  }

  public async onCastleClick(castleData: ApiPlayerCastleNameResponse): Promise<void> {
    this.isInLoading = true;
    const cid = castleData.id;
    this.cid = cid;
    await this.router.navigate([], { queryParams: { analysis: cid, kid: castleData.kingdomId } });
    await this.fetchCastleData(+cid, +(castleData.kingdomId || 0));
    this.cdr.detectChanges();
    return;
  }

  public async onBackButtonClick(): Promise<void> {
    const search = this.search || this.data.playerName;
    await this.router.navigate([], { queryParams: { analysis: null, search } });
    this.clearAllParameters();
    this.cdr.detectChanges();
    await this.searchPlayer(search);
    return;
  }

  public getSumBuildingSpecificItem(item: string): number {
    const object = this.castleObject;
    if (!object) return 0;
    const list = [...object.data.buildings, ...object.data.defenses, ...object.data.gates, ...object.data.towers];
    const sum = list.reduce((accumulator, entry) => {
      return accumulator + (Number(entry.data?.[item]) || 0);
    }, 0);
    return sum;
  }

  public onClick(event: MouseEvent): void {
    if (!this.canvasReady) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const mouseCanvasX = event.clientX - rect.left;
    const mouseCanvasY = event.clientY - rect.top;
    const cellX = Math.floor((mouseCanvasX - this.offsetX) / this.cellSize) + this.minX;
    const cellY = Math.floor((mouseCanvasY - this.offsetY) / this.cellSize) + this.minY;
    const hoveredBuilding = this.buildings.find((b) => {
      if (b.isGround) return false;
      const x = b.building.positionX;
      const y = b.building.positionY;
      const originalW = Number.parseInt(String(b.data?.['width']));
      const originalH = Number.parseInt(String(b.data?.['height']));
      const w = b.building.rotation === 1 ? originalH : originalW;
      const h = b.building.rotation === 1 ? originalW : originalH;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
        return false;
      }
      return Number.isFinite(x) && Number.isFinite(y) && cellX >= x && cellX < x + w && cellY >= y && cellY < y + h;
    });
    if (!hoveredBuilding) {
      this.tooltip = null;
      return;
    }
    const oId = hoveredBuilding.building.objectID;
    this.searchTerm = '#' + oId;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  public onMouseMove(event: MouseEvent): void {
    if (!this.canvasReady) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const mouseCanvasX = event.clientX - rect.left;
    const mouseCanvasY = event.clientY - rect.top;
    const cellX = Math.floor((mouseCanvasX - this.offsetX) / this.cellSize) + this.minX;
    const cellY = Math.floor((mouseCanvasY - this.offsetY) / this.cellSize) + this.minY;
    const hoveredBuilding = this.buildings.find((b) => {
      if (b.isGround) return false;
      const x = b.building.positionX;
      const y = b.building.positionY;
      const originalW = Number.parseInt(String(b.data?.['width']));
      const originalH = Number.parseInt(String(b.data?.['height']));
      const w = b.building.rotation === 1 ? originalH : originalW;
      const h = b.building.rotation === 1 ? originalW : originalH;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
        return false;
      }
      return Number.isFinite(x) && Number.isFinite(y) && cellX >= x && cellX < x + w && cellY >= y && cellY < y + h;
    });
    if (!hoveredBuilding) {
      this.tooltip = null;
      return;
    }

    const districtItems = this.getItemsInDistrict(hoveredBuilding);
    const name = this.capitalizeFirstLetter(this.getBuildingName(hoveredBuilding));
    const objectID = hoveredBuilding.building?.objectID;
    let info = [
      `<b>${name === '-' ? 'OID:' + objectID : name}</b> (${this.translations['Niveau']} ${hoveredBuilding.data?.['level']})`,
      '',
      `<b>${this.translations['Ordre public']}:</b> ${this.formatValue(Number(hoveredBuilding?.data['publicOrder'])) ?? this.translations['Inconnu']}`,
      `<b>${this.translations['Brûlable']}:</b> ${
        hoveredBuilding?.data?.['burnable'] === undefined
          ? this.translations['Oui']
          : Number.parseInt(String(hoveredBuilding?.data?.['burnable']))
            ? this.translations['Oui']
            : this.translations['Non']
      }`,
      `<b>${this.translations['Puissance']}:</b> ${this.formatValue(Number.parseInt(String(hoveredBuilding?.data?.['mightValue']))) ?? this.translations['Inconnu']}`,
      `<b>${this.translations['Commentaires']}:</b> ${
        hoveredBuilding?.data?.['comment1'] ?? ''
      }${hoveredBuilding?.data?.['comment2'] ? ', ' + (hoveredBuilding?.data?.['comment2'] ?? this.translations['Aucun']) : ''}`,
      `<b>${this.translations['Dimensions']}:</b> ${hoveredBuilding ? `${hoveredBuilding.data?.['width']}x${hoveredBuilding.data?.['height']}` : this.translations['Inconnu']}`,
      `<b>${this.translations['Prix de vente']}:</b> ${this.formatValue(Number.parseInt(String(hoveredBuilding?.data?.['sellC1']))) ?? this.translations['Inconnu']}`,
    ];

    if (districtItems.length > 0) {
      info.push(`<br><b>${this.translations['Espace dans le quartier']}: (${districtItems.length})</b>`);
      for (const item of districtItems) {
        info.push(
          `- ${this.capitalizeFirstLetter(this.getBuildingName(item))} (${this.translations['Niveau']} ${item.data?.['level']})`,
        );
      }
    }
    const constructionItems = Object.values(hoveredBuilding.constructionItems);
    info.push(`<br><b>${this.translations['Objets de construction']}: (${constructionItems.length})</b>`);
    const sortedConstructionItemsBySlotTypeID = constructionItems.sort((a, b) => {
      const slotA = Number(a['slotTypeID']);
      const slotB = Number(b['slotTypeID']);
      if (slotA === slotB) return 0;
      return slotA === 1 ? -1 : slotB === 1 ? 1 : slotA - slotB;
    });
    for (const item of sortedConstructionItemsBySlotTypeID) {
      const slotTypeName = this.getSlotTypeName(Number(item['slotTypeID']));
      info.push(
        `- ${slotTypeName} : ${this.capitalizeFirstLetter(String(item['translatedName']))} (${this.translations['Niveau']} ${item['level']})`,
      );
    }

    info = info.filter((item) => item !== null);

    if (hoveredBuilding) {
      this.tooltip = {
        x: event.pageX + 10,
        y: event.pageY + 10,
        text: info.join('<br>'),
      };
    } else {
      this.tooltip = null;
    }
    const tooltipElement = globalThis.document.querySelector('#tooltip') as HTMLElement | null;
    const tooltipHeight = tooltipElement?.offsetHeight || 0;
    const tooltipWidth = (tooltipElement?.offsetWidth || 0) + 16;
    if (tooltipHeight + 30 + event.pageY > window.innerHeight && this.tooltip)
      this.tooltip.y = window.innerHeight - tooltipHeight - 10;
    if (this.tooltip && this.tooltip.x + tooltipWidth > window.innerWidth) {
      this.tooltip.x = window.innerWidth - tooltipWidth - 10;
    }
  }

  public getSlotTypeName(slotTypeID: number | string | boolean | null): string {
    if (!this.languageJsonData) {
      return '-';
    }
    slotTypeID = String(slotTypeID);
    switch (slotTypeID) {
      case '1': {
        return (this.languageJsonData['CI_PRIMARYSLOT'] as string) || '-';
      }
      case '0': {
        return (this.languageJsonData['CI_APPEARANCESLOT'] as string) || '-';
      }
      case '2': {
        return (this.languageJsonData['CI_SECONDARYSLOT'] as string) || '-';
      }
      default: {
        return '';
      }
    }
  }

  private async getCastleData(): Promise<ApiResponse<ApiPlayerCastleNameResponse[]>> {
    return await this.apiRestService.getCastlePlayerDataByName(this.search);
  }

  private async fetchCastleData(cid: number, kid: number): Promise<void> {
    const castleResponse = await this.apiRestService.getCastlePlayerDataByCastleID(cid, kid);
    if (!castleResponse.success) {
      console.error('Failed to fetch castle data:', castleResponse);
      return;
    }
    await this.mapCastleJson(castleResponse.data);
    this.cdr.detectChanges();
  }

  private async fetchCastleJsonItems(): Promise<{ [key: string]: { [key: string]: string | number }[] }> {
    try {
      const response = await this.apiRestService.apiFetch<{ [key: string]: { [key: string]: string | number }[] }>(
        ApiRestService.apiUrl + this.itemsJsonUrl,
      );
      if (!response.success) {
        console.error('Error fetching castle JSON:', response.error);
        return {};
      }
      return response.data;
    } catch (error) {
      console.error('Error during fetch:', error);
      return {};
    }
  }

  private clearAllParameters(): void {
    this.itemsInDistricts = {};
    this.castles = [];
    this.buildings = [];
    this.visibleBuildings = [];
    this.tooltip = null;
    this.canvasReady = false;
    this.cid = null;
    this.cdr.detectChanges();
  }

  private addBuildingToDistrict(districtId: number, entry: IMappedBuildingWithGround): void {
    if (!this.itemsInDistricts[districtId]) {
      this.itemsInDistricts[districtId] = [];
    }
    this.itemsInDistricts[districtId].push(entry);
  }

  private computeGridMetrics(canvas: HTMLCanvasElement): void {
    const visibleWidth = this.maxX - this.minX;
    const visibleHeight = this.maxY - this.minY;

    this.cellSize = Math.min(canvas.width / visibleWidth, canvas.height / visibleHeight);
    const roundedTo2Decimals = Math.round(this.cellSize * 100) / 100;
    this.cellSize = roundedTo2Decimals;

    this.offsetX = (canvas.width - visibleWidth * this.cellSize) / 2;
    this.offsetY = (canvas.height - visibleHeight * this.cellSize) / 2;
  }

  private computeMapBoundsFromFloor(marginCells = 3): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const floors = this.castleObject?.data.grounds || [];
    for (const tile of floors) {
      const { positionX, positionY, rotation } = tile.building;
      const widthElement = tile.data?.['width'] ?? '1';
      const heightElement = tile.data?.['height'] ?? '1';
      const originalWidth = Number.parseInt(String(widthElement));
      const originalHeight = Number.parseInt(String(heightElement));
      const width = rotation === 1 ? originalHeight : originalWidth;
      const height = rotation === 1 ? originalWidth : originalHeight;
      minX = Math.min(minX, positionX);
      minY = Math.min(minY, positionY);
      maxX = Math.max(maxX, positionX + width);
      maxY = Math.max(maxY, positionY + height);
    }
    this.minX = minX - marginCells;
    this.minY = minY - marginCells;
    this.maxX = maxX + marginCells;
    this.maxY = maxY + marginCells;
    this.canvasReady = true;
    this.cdr.detectChanges();
  }

  private getTotalMapArea(): number {
    const floors = this.castleObject?.data.grounds || [];
    return floors.reduce((total, floor) => {
      const { width, height } = floor.data;
      return total + Number(width) * Number(height);
    }, 0);
  }

  private getPlaceNotOccupiedByAllBuildings(): number {
    const totalArea = this.getTotalMapArea();
    const occupiedArea = this.getPlaceOccupiedByAllBuildings();
    return totalArea - occupiedArea;
  }

  private getPlaceOccupiedByAllBuildings(): number {
    return this.buildings.reduce((total, entry) => {
      if (entry.isGround || entry.building.inDistrictID !== -1) return total;
      const widthElement = entry.data?.['width'] ?? '1';
      const heightElement = entry.data?.['height'] ?? '1';
      const originalWidth = Number.parseInt(String(widthElement));
      const originalHeight = Number.parseInt(String(heightElement));
      const width = entry.building.rotation === 1 ? originalHeight : originalWidth;
      const height = entry.building.rotation === 1 ? originalWidth : originalHeight;
      return total + width * height;
    }, 0);
  }

  private roundedTo2Decimals(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private drawBuildings(): void {
    this.computeGridMetrics(this.canvasRef.nativeElement);
    const context = this.canvasRef.nativeElement.getContext('2d');
    if (!context) return;
    const canvas = this.canvasRef.nativeElement;
    context.clearRect(0, 0, canvas.width, canvas.height);
    this.drawFloorPerimeter(context);
    for (const entry of this.buildings) {
      const { positionX, positionY, inDistrictID, rotation } = entry.building;
      if (positionX < 0 && positionY < 0 && inDistrictID) {
        this.addBuildingToDistrict(inDistrictID, entry);
        continue;
      }
      const widthElement = entry.data?.['width'] ?? '1';
      const heightElement = entry.data?.['height'] ?? '1';
      const originalWidth = Number.parseInt(String(widthElement));
      const originalHeight = Number.parseInt(String(heightElement));
      const width = rotation === 1 ? originalHeight : originalWidth;
      const height = rotation === 1 ? originalWidth : originalHeight;
      if (
        positionX + width < this.minX ||
        positionX > this.maxX ||
        positionY + height < this.minY ||
        positionY > this.maxY
      ) {
        continue;
      }
      const x = this.roundedTo2Decimals(this.offsetX + (positionX - this.minX) * this.cellSize);
      const y = this.roundedTo2Decimals(this.offsetY + (positionY - this.minY) * this.cellSize);
      const w = this.roundedTo2Decimals(width * this.cellSize);
      const h = this.roundedTo2Decimals(height * this.cellSize);
      if (entry.isGround) {
        const colors = ['#000000ff', '#3a2121ff'];
        context.fillStyle = colors[0];
        context.fillRect(x, y, w, h);
      } else {
        function parseToRgb(color: string): [number, number, number] {
          if (color.startsWith('#')) {
            const hex = color.slice(1);
            const h = (length: number, index: number): number =>
              Number.parseInt(
                length === 3 || length === 4 ? hex[index] + hex[index] : hex.slice(index * 2, index * 2 + 2),
                16,
              );
            const length = hex.length;
            if (length === 3 || length === 4 || length === 6 || length === 8)
              return [h(length, 0), h(length, 1), h(length, 2)];
          }
          const m = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
          if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
          return [128, 128, 128];
        }
        const rgbString = (r: number, g: number, b: number): string => `rgb(${r},${g},${b})`;
        function adjust([r, g, b]: [number, number, number], f: number): [number, number, number] {
          return [
            Math.min(255, Math.max(0, Math.round(r * f))),
            Math.min(255, Math.max(0, Math.round(g * f))),
            Math.min(255, Math.max(0, Math.round(b * f))),
          ];
        }
        function snapRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
          const sx = Math.round(x);
          const sy = Math.round(y);
          const sw = Math.max(1, Math.round(x + w) - sx);
          const sh = Math.max(1, Math.round(y + h) - sy);
          return { x: sx, y: sy, w: sw, h: sh };
        }
        function drawCellModern(
          context_: CanvasRenderingContext2D,
          x: number,
          y: number,
          w: number,
          h: number,
          baseColor: string,
        ): void {
          const { x: px, y: py, w: pw, h: ph } = snapRect(x, y, w, h);
          const base = parseToRgb(baseColor);
          const grad = context_.createLinearGradient(px, py, px, py + ph);
          const top = adjust(base, 1.15);
          const bottom = adjust(base, 0.85);
          grad.addColorStop(0, rgbString(...top));
          grad.addColorStop(1, rgbString(...bottom));
          context_.fillStyle = grad;
          context_.fillRect(px, py, pw, ph);
          if (pw >= 2 && ph >= 2) {
            context_.fillStyle = rgbString(...adjust(base, 1.25));
            context_.fillRect(px, py, pw, 1); // top
            context_.fillRect(px, py, 1, ph); // left
            context_.fillStyle = rgbString(...adjust(base, 0.7));
            context_.fillRect(px, py + ph - 1, pw, 1); // bottom
            context_.fillRect(px + pw - 1, py, 1, ph); // right
          }
        }
        const nameElement = entry.data?.['name'] ?? 'Unknown';
        const [color] = this.getItemColor(String(nameElement));
        drawCellModern(context, x, y, w, h, color);
      }
    }
    this.cdr.detectChanges();
  }

  private getItemColor(name: string): [string, string] {
    if (name === 'Castle') {
      return ['rgb(0,0,0)', 'rgb(0,0,0)'];
    }
    if (name === 'Deco') {
      return ['rgba(155, 135, 160)', 'rgb(109,68,119)'];
    }

    let hash = 0;
    for (let index = 0; index < name.length; index++) {
      //hash = name.charCodeAt(i) + ((hash << 5) - hash);
      hash = (name.codePointAt(index) || 0) + ((hash << 5) - hash);
    }

    let r1 = (hash >> 16) & 255;
    let g1 = (hash >> 8) & 255;
    let b1 = hash & 255;

    let r2 = Math.max(0, r1 - 30);
    let g2 = Math.max(0, g1 - 30);
    let b2 = Math.max(0, b1 - 30);

    if (r1 < 100 && g1 < 100 && b1 < 100) {
      r1 += 30;
      g1 += 30;
      b1 += 30;
      r2 += 30;
      g2 += 30;
      b2 += 30;
    }

    return [`rgb(${r1},${g1},${b1})`, `rgb(${r2},${g2},${b2})`];
  }

  private getFusionLevelPublicOrder(level: string): number {
    const l = Number.parseInt(level);
    if (!Number.isNaN(l)) {
      return 100 + l * 5;
    }
    return 0;
  }

  private countFitting(occupancy: number[][], w: number, h: number): number {
    const map = occupancy.map((row) => [...row]);
    const rows = map.length;
    const cols = map[0].length;
    let count = 0;

    for (let y = 0; y <= rows - h; y++) {
      for (let x = 0; x <= cols - w; x++) {
        let canPlace = true;
        for (let dy = 0; dy < h && canPlace; dy++) {
          for (let dx = 0; dx < w; dx++) {
            if (map[y + dy][x + dx] !== 1) {
              canPlace = false;
              break;
            }
          }
        }
        if (canPlace) {
          count++;
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              map[y + dy][x + dx] = 2;
            }
          }
        }
      }
    }
    return count;
  }

  private optimizePlacementWithMask(
    initialBuildings: IMappedBuildingWithGround[],
    constructionMap: number[][],
    minX: number,
    minY: number,
    tryOrders = 500,
  ): IMappedBuildingWithGround[] {
    const tryPlacement = (
      order: IMappedBuildingWithGround[],
    ): { buildings: IMappedBuildingWithGround[]; score: number } => {
      const buildings: IMappedBuildingWithGround[] = structuredClone(initialBuildings);
      const occupancy = constructionMap.map((row) => [...row]);

      for (const b of order) {
        let placed = false;
        for (const rotation of [0, 1]) {
          const w = Number(rotation === 1 ? b.data['height'] : b.data['width']);
          const h = Number(rotation === 1 ? b.data['width'] : b.data['height']);

          for (let y = 0; y <= occupancy.length - h; y++) {
            for (let x = 0; x <= occupancy[0].length - w; x++) {
              let canPlace = true;
              for (let dy = 0; dy < h && canPlace; dy++) {
                for (let dx = 0; dx < w; dx++) {
                  if (occupancy[y + dy][x + dx] !== 1) {
                    canPlace = false;
                    break;
                  }
                }
              }
              if (canPlace) {
                for (let dy = 0; dy < h; dy++) {
                  for (let dx = 0; dx < w; dx++) {
                    occupancy[y + dy][x + dx] = 2;
                  }
                }
                b.building.positionX = x + minX;
                b.building.positionY = y + minY;
                b.building.rotation = rotation;
                placed = true;
                break;
              }
            }
            if (placed) break;
          }
          if (placed) break;
        }
      }

      const score =
        this.countFitting(occupancy, 5, 10) * 1000 +
        this.countFitting(occupancy, 5, 5) * 100 +
        this.countFitting(occupancy, 3, 3) * 10 +
        this.countFitting(occupancy, 2, 2) * 5 +
        this.countFitting(occupancy, 1, 1);

      return { buildings, score };
    };
    const movable = initialBuildings.filter((b) => !b.isGround && b.building.inDistrictID === -1);
    const orders: IMappedBuildingWithGround[][] = [
      [...movable].sort(
        (a, b) =>
          Number(b.data['width']) * Number(b.data['height']) - Number(a.data['width']) * Number(a.data['height']),
      ),
      [...movable].sort(
        (a, b) =>
          Number(a.data['width']) * Number(a.data['height']) - Number(b.data['width']) * Number(b.data['height']),
      ),
    ];
    for (let index = 0; index < tryOrders; index++) {
      orders.push([...movable].sort(() => Math.random() - 0.5));
    }

    let best = { buildings: initialBuildings, score: -Infinity };
    for (const order of orders) {
      const result = tryPlacement(order);
      if (result.score > best.score) {
        best = result;
      }
    }

    return best.buildings;
  }

  private getPublicOrder(item: IMappedBuildingUnknownDataElement): number {
    if (item['decoPoints']) return Number.parseInt(String(item['decoPoints']));
    return this.getFusionLevelPublicOrder(String(item['initialFusionLevel']));
  }

  private async fetchGgeLanguage(): Promise<{ [key: string]: string | string[] }> {
    try {
      const currentLanguage = this.langageService.getCurrentLang();
      const response = await this.apiRestService.apiFetch<{ [key: string]: string | string[] }>(
        ApiRestService.apiUrl + 'languages/' + currentLanguage,
      );
      if (!response.success) {
        console.error('Error fetching GGE language:', response.error);
        return {};
      }
      return response.data;
    } catch (error) {
      console.error('Error during fetch:', error);
      return {};
    }
  }

  private getRawBuildingName(bt: string, ky: string, gp: string): string {
    const r = [ky, bt, gp].map((s) => s.trim().toUpperCase());
    const k = ['LEVEL', 'NAME', '_', '-', '', 'MOAT', 'GATE', 'WALL', 'TOWER'];
    if (r[0].startsWith(k[0])) {
      r[0] = k[4];
    } else {
      r[0] += k[2];
    }
    if ([k[5], k[8]].includes(r[2])) {
      r[0] += r[2] + k[2];
    } else if (r[2] === k[6]) {
      r[1] = r[2];
    }
    return r[1] + k[2] + r[0] + k[1];
  }

  private getLangKey(buildingType: string, key: string, group: string): string {
    if (!buildingType || !key) return '-';
    const value = this.getRawBuildingName(buildingType, key, group);
    if (!this.languageJsonData) {
      return '-';
    }
    const target: string | string[] = this.languageJsonData[value];
    if (Array.isArray(target)) {
      return target[0] || '-';
    }
    return target || '-';
  }

  private upperAllKeys(object: { [key: string]: string | string[] }): { [key: string]: string | string[] } {
    if (typeof object !== 'object' || object === null) return object;
    const uppercasedObject: { [key: string]: string | string[] } = {};
    for (const key of Object.keys(object)) {
      const upperKey = key.toUpperCase();
      uppercasedObject[upperKey] = object[key];
    }
    return uppercasedObject;
  }

  private getFormatedLevel(level: number, legendaryLevel: number): string {
    return level === 70 ? `${level}/${legendaryLevel}` : `${level}`;
  }

  public get paginatedBuildings(): IMappedBuildingWithGround[] {
    let filtered = this.visibleBuildings;

    if (this.searchTerm.trim()) {
      const lower = this.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          String(m.building.wodID).toLowerCase().includes(lower) ||
          this.getBuildingName(m).toLowerCase().includes(lower) ||
          String(m.data['level']).toLowerCase().includes(lower) ||
          String(m.data['publicOrder']).toLowerCase().includes(lower) ||
          String((m.building.damageFactor * 100) / 1 + '%')
            .toLowerCase()
            .includes(lower) ||
          String(m.data['mightValue']).toLowerCase().includes(lower) ||
          String(m.data['width']).toLowerCase().includes(lower) ||
          String(m.data['height']).toLowerCase().includes(lower) ||
          String(m.building['internalID']).toLowerCase() === lower ||
          String(m.data['sellC1']).toLowerCase().includes(lower) ||
          String(m.data['comment1']).toLowerCase().includes(lower) ||
          String(m.data['comment2']).toLowerCase().includes(lower),
      );
    }
    const sortColumn = this.sortColumn;
    if (sortColumn) {
      const nestedColumn = sortColumn.split('.');
      filtered = [...filtered].sort((a, b) => {
        const aValue = nestedColumn.reduce<any>((object, key) => object?.[key], a) ?? '';
        const bValue = nestedColumn.reduce<any>((object, key) => object?.[key], b) ?? '';
        const type = typeof aValue;
        switch (type) {
          case 'string': {
            return (
              ('' + aValue).localeCompare('' + bValue, undefined, {
                sensitivity: 'base',
              }) * (this.sortAsc ? 1 : -1)
            );
          }
          case 'number': {
            return (aValue - bValue) * (this.sortAsc ? 1 : -1);
          }
          case 'boolean': {
            return (aValue === bValue ? 0 : aValue ? 1 : -1) * (this.sortAsc ? 1 : -1);
          }
          default: {
            return 0;
          }
        }
      });
    }

    this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize;
    const f = filtered.slice(start, start + this.pageSize);
    return f;
  }

  private mapDataFromJson(): void {
    if (!this.castleObject) return;
    this.data = {
      playerName: this.castleObject.playerName ?? '-',
      castleName: this.castleObject.castleName ?? '-',
      castleType: this.getCastleType(this.castleObject.castleType),
      level: this.getFormatedLevel(this.castleObject.level, this.castleObject.legendaryLevel ?? 0),
      positionX: this.castleObject.positionX,
      positionY: this.castleObject.positionY,
      sumOP: this.getSumBuildingSpecificItem('publicOrder'),
      sumMight: this.getSumBuildingSpecificItem('mightValue'),
      placeOccupied: this.getPlaceOccupiedByAllBuildings(),
      placeNotOccupied: this.getPlaceNotOccupiedByAllBuildings(),
      nbFloors: this.castleObject.data.grounds.length,
      maxFloors: this.data.maxFloors,
      nbFire: this.getFireCount(),
    };
  }

  private async mapCastleJson(castleData: ApiPlayerCastleDataResponse): Promise<void> {
    const castleJsonData = await this.fetchCastleJsonItems();
    this.effects = castleJsonData['effects'];
    this.effectTypes = castleJsonData['effecttypes'];
    this.languageJsonData = this.upperAllKeys(await this.fetchGgeLanguage());
    const buildingItems = castleJsonData['buildings'];
    const constructionItems = castleJsonData['constructionItems'];
    const result: ApiPlayerCastleDataMapped = {
      ...castleData,
      data: {
        buildings: [],
        defenses: [],
        gates: [],
        grounds: [],
        towers: [],
      },
      constructionItems: [],
    };
    for (const castleDataCategory of Object.entries(castleData.data)) {
      const [category, data] = castleDataCategory;
      for (const [index, datum] of data.entries()) {
        const item = {
          ...datum,
          internalID: '#' + datum.objectID,
        };
        const b = buildingItems.find((object: { [key: string]: string | number }) => object['wodID'] === item.wodID);
        if (!b) {
          console.warn(`Item with wodID ${item.wodID} not found in items.`);
          continue;
        }
        result.data[category as keyof typeof castleData.data][index] = {
          building: item,
          data: this.mapDataObject(b),
          constructionItems: {},
        };
      }
    }

    let mappedConstructionItems: { [key: string]: ConstructionItem[] } = {};
    for (const [oid, elements] of Object.entries(castleData.constructionItems)) {
      for (const [cid] of elements) {
        const item: IMappedBuildingUnknownDataElement | undefined = constructionItems.find(
          (object: { [key: string]: string | number }) => object['constructionItemID'] === String(cid),
        );
        if (!item) continue;
        let targetObject;
        try {
          targetObject = result.data.buildings.find((g) => g.building.objectID === Number(oid));
        } catch (error) {
          console.error('Error finding target object:', error);
        }
        if (!targetObject) continue;
        const object: IMappedBuildingUnknownDataElement = this.mapConstructionItemObject(item);
        const type = item['slotTypeID'] as string;
        targetObject['constructionItems'][type] = targetObject['constructionItems'][type] || [];
        targetObject['constructionItems'][type] = object;
        if (!mappedConstructionItems[oid]) {
          mappedConstructionItems[oid] = [];
        }
        mappedConstructionItems[oid].push(object);
      }
    }
    this.constructionItems = mappedConstructionItems;
    this.castleObject = result;
    this.buildings = [
      ...result.data.grounds.map((ground) => ({
        building: ground.building,
        data: ground.data,
        constructionItems: ground.constructionItems,
        isGround: true,
      })),
      ...result.data.buildings.map((building) => ({
        building: building.building,
        data: building.data,
        constructionItems: building.constructionItems,
        isGround: false,
      })),
    ];
    this.grounds = result.data.grounds.map((ground) => ({
      building: ground.building,
      data: ground.data,
      constructionItems: ground.constructionItems,
      isGround: true,
    }));
    this.visibleBuildings = [
      ...result.data.gates.map((gates) => ({
        building: gates.building,
        data: gates.data,
        constructionItems: gates.constructionItems,
        isGround: false,
      })),
      ...result.data.defenses.map((defenses) => ({
        building: defenses.building,
        data: defenses.data,
        constructionItems: defenses.constructionItems,
        isGround: false,
      })),
      ...result.data.buildings.map((building) => ({
        building: building.building,
        data: building.data,
        constructionItems: building.constructionItems,
        isGround: false,
      })),
      ...result.data.towers.map((tower) => ({
        building: tower.building,
        data: tower.data,
        constructionItems: tower.constructionItems,
        isGround: false,
      })),
    ];
    const keepElement = this.visibleBuildings.filter((b) => String(b.data['name']) === 'Keep');
    this.visibleBuildings = [...keepElement, ...this.visibleBuildings.filter((b) => String(b.data['name']) !== 'Keep')];
    this.mapDataFromJson();
    this.isInLoading = false;
    this.cdr.detectChanges();
    this.computeMapBoundsFromFloor();
    this.generateConstructionMap(this.castleObject.data.grounds, this.minX, this.minY, this.maxX, this.maxY);
    this.allVisibleBuildings = [...this.visibleBuildings];
    const c = this.visibleBuildings.map((building) => {
      if (!building.data['buildingGroundType']) return { label: '', value: '' };
      return {
        label: String(building.data['buildingGroundType'] ?? ''),
        value: String(building.data['buildingGroundType'] ?? ''),
      };
    });
    this.constructionTypes = c
      .filter((item): item is { label: string; value: string } => !!item)
      .reduce((accumulator: { label: string; value: string }[], current) => {
        if (!accumulator.some((item) => item.value === current.value)) {
          accumulator.push(current);
        }
        return accumulator;
      }, [])
      .sort((a, b) => a.label.localeCompare(b.label));
    this.constructionTypes.unshift({ label: this.translations['Tous'], value: null });
    this.drawBuildings();
  }

  private generateConstructionMap(
    grounds: IMappedBuildingElement[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): number[][] {
    const width = maxX - minX;
    const height = maxY - minY;
    const map: number[][] = Array.from({ length: height }, () => Array.from<number>({ length: width }).fill(0));
    for (const tile of grounds) {
      const gx = tile.building.positionX - minX;
      const gy = tile.building.positionY - minY;
      const w = tile.data?.['width'] ?? 1;
      const h = tile.data?.['height'] ?? 1;
      const widthCell = Number(tile.building.rotation === 1 ? h : w);
      const heightCell = Number(tile.building.rotation === 1 ? w : h);
      for (let dy = 0; dy < heightCell; dy++) {
        for (let dx = 0; dx < widthCell; dx++) {
          if (gy + dy >= 0 && gy + dy < height && gx + dx >= 0 && gx + dx < width) {
            map[gy + dy][gx + dx] = 1;
          }
        }
      }
    }
    return map;
  }

  private async translateKeys(): Promise<void> {
    const keys = Object.keys(this.translations);
    for (const key of keys) {
      const translation = await this.translateService.get(key).toPromise();
      this.translations[key as keyof typeof this.translations] = translation;
    }
  }

  private edgeKey = (sx: number, sy: number, ex: number, ey: number): string => `${sx},${sy}->${ex},${ey}`;

  private drawFloorPerimeter(context: CanvasRenderingContext2D): void {
    const floors = this.castleObject?.data.grounds || [];
    if (!floors || floors.length === 0) return;
    let fxMin = Infinity,
      fyMin = Infinity,
      fxMax = -Infinity,
      fyMax = -Infinity;
    for (const f of floors) {
      const widthElement = f.data?.['width'] ?? '1';
      const heightElement = f.data?.['height'] ?? '1';
      let w = Number.parseInt(String(widthElement), 10);
      let h = Number.parseInt(String(heightElement), 10);
      if (f.building.rotation === 1) [w, h] = [h, w];
      const x1 = f.building.positionX;
      const y1 = f.building.positionY;
      const x2 = x1 + w;
      const y2 = y1 + h;
      fxMin = Math.min(fxMin, x1);
      fyMin = Math.min(fyMin, y1);
      fxMax = Math.max(fxMax, x2);
      fyMax = Math.max(fyMax, y2);
    }
    const gridW = Math.max(1, fxMax - fxMin);
    const gridH = Math.max(1, fyMax - fyMin);
    const grid: Uint8Array[] = Array.from({ length: gridH });
    for (let y = 0; y < gridH; y++) {
      grid[y] = new Uint8Array(gridW);
    }
    for (const f of floors) {
      const widthElement = f.data?.['width'] ?? '1';
      const heightElement = f.data?.['height'] ?? '1';
      let w = Number.parseInt(String(widthElement), 10);
      let h = Number.parseInt(String(heightElement), 10);
      if (f.building.rotation === 1) [w, h] = [h, w];
      const sx = f.building.positionX - fxMin;
      const sy = f.building.positionY - fyMin;
      for (let yy = 0; yy < h; yy++) {
        const gy = sy + yy;
        if (gy < 0 || gy >= gridH) continue;
        for (let xx = 0; xx < w; xx++) {
          const gx = sx + xx;
          if (gx < 0 || gx >= gridW) continue;
          grid[gy][gx] = 1;
        }
      }
    }
    const edges = new Map<string, Pt[]>();
    const pushEdge = (sx: number, sy: number, ex: number, ey: number): void => {
      const key = `${sx},${sy}`;
      const list = edges.get(key) ?? [];
      list.push({ x: ex, y: ey });
      edges.set(key, list);
    };
    const isFilled = (gx: number, gy: number): boolean => {
      if (gx < 0 || gy < 0 || gy >= gridH || gx >= gridW) return false;
      return grid[gy][gx] === 1;
    };
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (!isFilled(gx, gy)) continue;
        if (!isFilled(gx, gy - 1)) pushEdge(gx, gy, gx + 1, gy);
        if (!isFilled(gx + 1, gy)) pushEdge(gx + 1, gy, gx + 1, gy + 1);
        if (!isFilled(gx, gy + 1)) pushEdge(gx + 1, gy + 1, gx, gy + 1);
        if (!isFilled(gx - 1, gy)) pushEdge(gx, gy + 1, gx, gy);
      }
    }
    const edgeUsed = new Set<string>();
    const polygons: Pt[][] = [];
    for (const [startKey, ends] of edges) {
      const startPts = startKey.split(',').map(Number);
      const sx = startPts[0],
        sy = startPts[1];
      for (const end of ends) {
        const ex = end.x,
          ey = end.y;
        const k = this.edgeKey(sx, sy, ex, ey);
        if (edgeUsed.has(k)) continue;
        const poly: Pt[] = [];
        let currentX = sx,
          currentY = sy;
        let nextX = ex,
          nextY = ey;
        poly.push({ x: currentX, y: currentY });
        edgeUsed.add(k);
        while (true) {
          currentX = nextX;
          currentY = nextY;
          poly.push({ x: currentX, y: currentY });
          const currentKey = `${currentX},${currentY}`;
          const list = edges.get(currentKey) ?? [];
          let found = false;
          for (const candidate of list) {
            const k2 = this.edgeKey(currentX, currentY, candidate.x, candidate.y);
            if (!edgeUsed.has(k2)) {
              edgeUsed.add(k2);
              nextX = candidate.x;
              nextY = candidate.y;
              found = true;
              break;
            }
          }
          if (!found) break;
          if (nextX === sx && nextY === sy) break;
        }
        if (poly.length >= 3) polygons.push(poly);
      }
    }
    if (polygons.length === 0) return;
    const polygonArea = (poly: Pt[]): number => {
      let area = 0;
      for (let index = 0; index < poly.length; index++) {
        const a = poly[index];
        const b = poly[(index + 1) % poly.length];
        area += a.x * b.y - b.x * a.y;
      }
      return Math.abs(area) / 2;
    };
    let largest = polygons[0];
    let maxArea = polygonArea(largest);
    for (const p of polygons) {
      const a = polygonArea(p);
      if (a > maxArea) {
        maxArea = a;
        largest = p;
      }
    }
    const pointsPx = largest.map((pt) => {
      const worldX = fxMin + pt.x;
      const worldY = fyMin + pt.y;
      const px = this.offsetX + (worldX - this.minX) * this.cellSize;
      const py = this.offsetY + (worldY - this.minY) * this.cellSize;
      return { x: px, y: py };
    });
    if (pointsPx.length < 2) return;
    const borderSize = 15;
    context.save();
    context.lineJoin = 'miter';
    context.lineCap = 'butt';

    context.beginPath();
    context.moveTo(pointsPx[0].x, pointsPx[0].y);
    for (let index = 1; index < pointsPx.length; index++) context.lineTo(pointsPx[index].x, pointsPx[index].y);
    context.closePath();
    context.lineWidth = borderSize * 3;
    context.strokeStyle = 'rgba(34,169,187,0.42)';
    context.translate(-context.lineWidth / 2, -context.lineWidth / 2);
    context.stroke();
    context.translate(context.lineWidth / 2, context.lineWidth / 2);

    context.beginPath();
    context.moveTo(pointsPx[0].x, pointsPx[0].y);
    for (let index = 1; index < pointsPx.length; index++) context.lineTo(pointsPx[index].x, pointsPx[index].y);
    context.closePath();
    context.lineWidth = borderSize;
    context.strokeStyle = 'rgba(0,0,0,0.5)';
    context.translate(-context.lineWidth / 2, -context.lineWidth / 2);
    context.stroke();
    context.translate(context.lineWidth / 2, context.lineWidth / 2);

    context.restore();
  }

  private mapDataObject(data: IMappedBuildingUnknownDataElement): IMappedBuildingUnknownDataElement {
    if (!this.languageJsonData) throw new Error('Language JSON data is not loaded');
    const effects: string[] = this.getAreaSpecificEffects(data);
    return {
      ...data,
      mightValue: Number(data['mightValue']) || 0,
      level: Number(data['level']) || 0,
      publicOrder: this.getPublicOrder(data),
      translatedName: this.capitalizeFirstLetter(this.getBuildingNameFromData(data)),
      effects: JSON.stringify(effects),
      totalwidth: (Number(data['width']) ?? 0) * (Number(data['height']) ?? 0),
      buildingGroundType: String(this.languageJsonData[String(data['buildingGroundType'])] ?? '-'),
      originalBuildingGroundType: String(data['buildingGroundType']) ?? '-',
    };
  }

  private getBaseNameTextId(slotTypeID: string): string | null {
    switch (slotTypeID) {
      case '0': {
        return 'ci_appearance';
      }
      case '1': {
        return 'ci_primary';
      }
      case '2': {
        return 'ci_secondary';
      }
    }
    return null;
  }

  private getBoxUrl(data: IMappedBuildingUnknownDataElement): string {
    return `/assets/ci/${this.getBaseNameTextId(String(data['slotTypeID']))}_${this.getRarenessNames()[Number(data['rarenessID'])] || 'unknown'}.png`.toLowerCase();
  }

  private getRarenessNames(): { [key: number]: string } {
    return { 0: 'unique', 1: 'common', 2: 'rare', 3: 'epic', 4: 'legendary' };
  }

  private mapConstructionItemObject(data: IMappedBuildingUnknownDataElement): IMappedBuildingUnknownDataElement {
    try {
      const RARENESS_COLORS = { 0: 10_686_223, 1: 8_816_262, 2: 6_983_196, 3: 9_058_259, 4: 15_687_936 };
      const RARENESS_NAMES = this.getRarenessNames();
      function toHex(value: number): string {
        return '#' + value.toString(16).padStart(6, '0');
      }
      if (!this.languageJsonData) {
        throw new Error('Language JSON data is not loaded');
      }
      const [effectId, effectValue] = String(data['effects']).split('&');
      let effectCode = this.effects.find((effect) => effect['effectID'] === effectId);
      if (data['effects']) {
        const key = effectCode && effectCode['name'];
        const name = this.languageJsonData[('equip_effect_description_' + key).toUpperCase()];
        if (name) {
          effectCode = {
            name: (name as String).replace('{0}', String(effectValue)),
          };
        } else {
          const name = this.languageJsonData[('ci_effect_' + key).toUpperCase()];
          if (name) {
            effectCode = {
              name: (name as String).replace('{0}', String(effectValue)),
            };
          } else {
            const target = effectValue.split('+');
            effectCode = {
              name: (this.languageJsonData[('ci_effect_' + key + '_' + target[0]).toUpperCase()] as String).replace(
                '{0}',
                String(target[1]),
              ),
            };
          }
        }
      } else {
        if (data['decoPoints']) {
          const name = this.languageJsonData['ci_effect_decoPoints'.toUpperCase()];
          effectCode = {
            name: (name as String).replace('{0}', String(data['decoPoints'])),
          };
        } else {
          const legacyEffectFields: [string, boolean][] = [
            ['unitWallCount', false],
            ['recruitSpeedBoost', true],
            ['woodStorage', false],
            ['stoneStorage', false],
            ['ReduceResearchResourceCosts', true],
            ['Stoneproduction', false],
            ['Woodproduction', false],
            ['Foodproduction', false],
            ['foodStorage', false],
            ['unboostedFoodProduction', false],
            ['defensiveToolsSpeedBoost', true],
            ['defensiveToolsCostsReduction', true],
            ['meadStorage', false],
            ['recruitCostReduction', true],
            ['honeyStorage', false],
            ['hospitalCapacity', false],
            ['healSpeed', true],
            ['marketCarriages', false],
            ['XPBoostBuildBuildings', true],
            ['stackSize', false],
            ['glassStorage', false],
            ['Glassproduction', false],
            ['ironStorage', false],
            ['Ironproduction', false],
            ['coalStorage', false],
            ['Coalproduction', false],
            ['oilStorage', false],
            ['Oilproduction', false],
            ['offensiveToolsCostsReduction', true],
            ['feastCostsReduction', true],
            ['Meadreduction', true],
            ['surviveBoost', true],
            ['unboostedStoneProduction', false],
            ['unboostedWoodProduction', false],
            ['offensiveToolsSpeedBoost', true],
            ['espionageTravelBoost', true],
          ];
          for (const [key] of legacyEffectFields) {
            if (data[key] !== undefined) {
              const count = data[key];
              const name = this.languageJsonData[('ci_effect_' + key).toUpperCase()];
              effectCode = {
                name: (name as String).replace('{0}', String(count)),
              };
            }
          }
        }
      }
      return {
        ...data,
        isPremium: data['isPremium'] === '1' ? true : false,
        slotTypeName: this.getSlotTypeName(data['slotTypeID']),
        slotTypeID: Number(data['slotTypeID']) || 0,
        level: String(data['slotTypeID']) === '0' ? '1' : Number(data['level']),
        rarenessName: String(
          this.languageJsonData[
            (
              'equipment_rarity_' + RARENESS_NAMES[Number(data['rarenessID']) as keyof typeof RARENESS_NAMES] ||
              'unknown'
            ).toUpperCase()
          ],
        ),
        rarenessColor: toHex(RARENESS_COLORS[Number(data['rarenessID']) as keyof typeof RARENESS_COLORS] || 0),
        translatedName: String(
          this.languageJsonData[
            (this.getBaseNameTextId(String(data['slotTypeID'])) + '_' + data['name'] || 'unknown').toUpperCase()
          ],
        ),
        boxUrl: this.getBoxUrl(data),
        effect: effectCode ? effectCode['name'] : null,
      };
    } catch (error) {
      console.error('Error in transformData:', error);
      return { ...data, effect: null };
    }
  }

  private getColorMap(castle: ApiPlayerCastleNameResponse): string[] {
    switch (castle.kingdomId) {
      case 0: {
        return ['#929E3F', '#0e0e0e56'];
      }
      case 1: {
        return ['#e3d191', '#0e0e0e56'];
      }
      case 2: {
        return ['#f3f2f2', '#0e0e0e56'];
      }
      case 3: {
        return ['#46362a', '#ffffff56'];
      }
    }
    return [];
  }

  private drawMiniMaps(): void {
    this.miniMaps.forEach((canvasReference, index) => {
      const castle = this.castles[index];
      const context = canvasReference.nativeElement.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, this.miniSize, this.miniSize);
      context.fillStyle = this.getColorMap(castle)[0];
      context.fillRect(0, 0, this.miniSize, this.miniSize);
      const x = (castle.positionX / this.mapSize) * this.miniSize;
      const y = (castle.positionY / this.mapSize) * this.miniSize;
      context.fillStyle = this.getColorMap(castle)[1];
      context.beginPath();
      context.arc(x, y, 3, 0, 2 * Math.PI);
      context.fill();
      context.strokeStyle = this.getColorMap(castle)[1];
      context.lineWidth = 1;
      context.stroke();
    });
  }

  private getFireCount(): number {
    return this.visibleBuildings.filter((b) => b.building.damageFactor > 0).length;
  }

  private getAreaSpecificEffects(data: IMappedBuildingUnknownDataElement): string[] {
    if (!this.languageJsonData) {
      return [];
    }
    const areaSpecificEffects = data['areaSpecificEffects'];
    if (!areaSpecificEffects || typeof areaSpecificEffects !== 'string') {
      return [];
    } else {
      const splitEffects = areaSpecificEffects.split(',');
      const effects = [];
      let index = -1;
      for (const effect of splitEffects) {
        index++;
        const [id, value] = effect.split('&');
        const findEffect = this.effects.find((effect) => effect['effectID'] === id);
        if (!findEffect) {
          console.warn(`Effect with ID ${id} not found in effects.`);
          continue;
        }
        const tries = ['effect_name_' + findEffect['name'], 'equip_effect_description_' + findEffect['name']];
        effects[index] = null;
        let currentName: string | null = effects[index];
        for (const tryKey of tries) {
          if (currentName) break;
          const name = this.languageJsonData[tryKey.toUpperCase()];
          if (name) {
            const searchType = this.effectTypes.find(
              (effectType) => effectType['effectTypeID'] === findEffect['effectTypeID'],
            );
            const name2 = this.languageJsonData[('ci_effect_' + searchType!['name']).toUpperCase()];
            if (name2) {
              currentName = String(name2).replace('{0}', value);
            } else {
              if (name.includes('{0}')) {
                currentName = String(name).replace('{0}', value);
              } else {
                if (String(findEffect['name']).includes('Unboosted') || String(findEffect['name']).includes('Amount')) {
                  const isPositive = Number(value) > 0;
                  const sign = isPositive ? '+' : '-';
                  currentName = String(name) + ' : ' + sign + value;
                } else {
                  const isPositive = Number(value) > 0;
                  currentName = String(name) + ' : ' + (isPositive ? '+' : '-') + value + '%';
                }
              }
            }
          }
        }
        effects[index] = currentName;
        if (!currentName) {
          const searchType = this.effectTypes.find(
            (effectType) => effectType['effectTypeID'] === findEffect['effectTypeID'],
          );
          console.warn(`Effect name for ${findEffect['name']} not found in language data.`, searchType, data, value);
        }
      }
      return effects.filter((effect: string | null) => effect !== null && effect !== undefined) as string[];
    }
  }

  private getEffectValue(name: string): string {
    name = name.trim().toUpperCase();
    switch (name) {
      case 'Woodproduction'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'Stoneproduction'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'Foodproduction'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'Coalproduction'.toUpperCase(): {
        return '';
      }
      case 'Oilproduction'.toUpperCase(): {
        return '';
      }
      case 'Glassproduction'.toUpperCase(): {
        return '';
      }
      case 'Ironproduction'.toUpperCase(): {
        return '';
      }
      case 'Woodboost'.toUpperCase(): {
        return '';
      }
      case 'Stoneboost'.toUpperCase(): {
        return '';
      }
      case 'Foodboost'.toUpperCase(): {
        return '';
      }
      case 'alliFoodProductionBonus'.toUpperCase(): {
        return '';
      }
      case 'Coalboost'.toUpperCase(): {
        return '';
      }
      case 'Oilboost'.toUpperCase(): {
        return '';
      }
      case 'Glassboost'.toUpperCase(): {
        return '';
      }
      case 'Ironboost'.toUpperCase(): {
        return '';
      }
      case 'Foodreduction'.toUpperCase(): {
        return '';
      }
      case 'Hideout'.toUpperCase(): {
        return '';
      }
      case 'decoPoints'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'Population'.toUpperCase(): {
        return '';
      }
      case 'woodStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'stoneStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'foodStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'coalStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'oilStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'glassStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'ironStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'honeyStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'meadStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'beefStorage'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'marketCarriages'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'sightRadiusBonus'.toUpperCase(): {
        return '';
      }
      case 'commanderSize'.toUpperCase(): {
        return '';
      }
      case 'guardSize'.toUpperCase(): {
        return '';
      }
      case 'spySize'.toUpperCase(): {
        return '';
      }
      case 'buildingCostReduction'.toUpperCase(): {
        return '';
      }
      case 'shownTravelBonus'.toUpperCase(): {
        return '';
      }
      case 'islandAlliancePoints'.toUpperCase(): {
        return '';
      }
      case 'buildSpeedBoost'.toUpperCase(): {
        return '';
      }
      case 'surviveBoost'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
      case 'hospitalCapacity'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'hospitalSlots'.toUpperCase(): {
        return '';
      }
      case 'recruitCostReduction'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
      case 'stackSize'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'healSpeed'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_ADD;
      }
      case 'recruitSpeedBoost'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_ADD;
      }
      case 'unitWallCount'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'unboostedFoodProduction'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'unboostedWoodProduction'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'unboostedStoneProduction'.toUpperCase(): {
        return GenericTextIds.VALUE_NOMINAL_ADD;
      }
      case 'espionageTravelBoost'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_ADD;
      }
      case 'defensiveToolsCostsReduction'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
      case 'defensiveToolsSpeedBoost'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_ADD;
      }
      case 'feastCostsReduction'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
      case 'offensiveToolsCostsReduction'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
      case 'offensiveToolsSpeedBoost'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_ADD;
      }
      case 'ReduceResearchResourceCosts'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
      case 'XPBoostBuildBuildings'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_ADD;
      }
      case 'districtSlots'.toUpperCase(): {
        return '';
      }
      case 'Meadreduction'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
      case 'Beefreduction'.toUpperCase(): {
        return GenericTextIds.VALUE_PERCENTAGE_SUBTRACT;
      }
    }
    return '';
  }
}
