import { DecimalPipe, NgClass, NgStyle } from '@angular/common';
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
import { FormsModule } from '@angular/forms';
import { FilterComponent } from '@ggetracker-components/filter/filter.component';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { LoadingComponent } from '@ggetracker-components/loading/loading.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { SearchbarComponent } from '@ggetracker-components/searchbar/searchbar.component';
import { ISelectItem, SelectComponent } from '@ggetracker-components/select/select.component';
import { SwitchComponent } from '@ggetracker-components/switch/switch.component';
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
import { IMappedBuildingWithGround } from '@ggetracker-interfaces/view-castle';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslatePipe } from '@ngx-translate/core';
import { Castle, LucideAngularModule } from 'lucide-angular';
import { BuildingImgComponent } from './app-building-img/building-img.component';
import { ViewCastleUtilities } from './view-castle-utilities';

@Component({
  selector: 'app-view-castle',
  imports: [
    SearchFormComponent,
    TranslatePipe,
    NgClass,
    DecimalPipe,
    LucideAngularModule,
    LoadingComponent,
    FormsModule,
    BuildingImgComponent,
    SwitchComponent,
    NgStyle,
    SelectComponent,
    FilterComponent,
    SearchbarComponent,
    SearchbarComponent,
  ],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './view-castle.component.html',
  styleUrl: './view-castle.component.css',
})
export class ViewCastleComponent extends GenericComponent implements OnInit {
  private static readonly RARENESS_NAMES: Record<number, string> = {
    0: 'unique',
    1: 'common',
    2: 'rare',
    3: 'epic',
    4: 'legendary',
  };
  private static readonly RARENESS_COLORS: Record<number, number> = {
    0: 10_686_223,
    1: 8_816_262,
    2: 6_983_196,
    3: 9_058_259,
    4: 15_687_936,
  };

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
  @ViewChild('mapCanvas', { static: false }) public canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChildren('miniMap') public miniMaps!: QueryList<ElementRef<HTMLCanvasElement>>;
  public buildingStyles: Record<string, Record<string, string>> = {};
  public allVisibleBuildings: IMappedBuildingWithGround[] = [];
  public visibleBuildings: IMappedBuildingWithGround[] = [];
  public selectedItem: IMappedBuildingWithGround | null = null;
  public currentActivatedEffects: string[] = [];
  public constructionTypes: ISelectItem[] = [];
  public regroupedEffects: { effectId: string; name: string; type: string; value: number }[] = [];
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
  public pageSize = 7;
  public canvasWidth = window.innerWidth < 1000 ? window.innerWidth - 40 : 900;
  public canvasHeight = window.innerWidth < 1000 ? window.innerWidth - 40 : 900;
  public currentPage = 1;
  public totalPages = 1;
  public castles: ApiPlayerCastleNameResponse[] = [];
  public constructionItems: { [key: string]: ConstructionItem[] } = {};
  public castleObject: ApiPlayerCastleDataMapped | null = null;
  public search = '';
  public canvasReady = false;
  public activeView: 'canvas' | 'grid' = 'canvas';
  public calculatedCastleProperties = {
    playerName: '',
    castleName: '',
    castleType: '',
    positionX: 0,
    positionY: 0,
    level: '',
    sightRadius: 0,
    guardSize: 0,
    publicOrder: {
      base: 0,
      effects: 0,
    },
    wall: {
      base: 0,
      effects: 0,
    },
    sumMight: 0,
    placeOccupied: 0,
    placeNotOccupied: 0,
    nbFloors: 0,
    maxFloors: 20,
    nbFire: 0,
  };
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
  private _filteredBuildings: IMappedBuildingWithGround[] = [];
  private cdr = inject(ChangeDetectorRef);
  private serverService = inject(ServerService);

  constructor() {
    super();
    this.isInLoading = true;
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
    } else {
      void this.fetchRandomCastles();
    }
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  public onSearchChange(): void {
    this.currentPage = 1;
    this.applyFilterAndSort();
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
    this.clearAllParameters();
    if (!playerName) {
      // Reset state if search is empty
      await this.router.navigate([], { queryParams: { search: null } });
      this.cdr.detectChanges();
      return;
    }
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
    if (typeof value === 'number') {
      value = Math.ceil(value);
    }
    return Number.isInteger(value) && value !== null
      ? value.toString().replaceAll(regex, ',')
      : this.translations['Inconnu'];
  }

  public displayUnavailableCastleMessage(): void {
    const message = this.translateService.instant('server-not-available', {
      server: this.serverService.currentServer?.name,
    });
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

  /**
   * Helper function to construct the URL for a construction item image based on its name.
   * This function is called from HTML templates to dynamically generate the image source for construction items.
   * @param entry The construction item entry containing the name of the item.
   * @returns The URL of the construction item image.
   */
  public getConstructionUrl(entry: ConstructionItem): string {
    const basePath = ApiRestService.apiUrl + 'assets/common/';
    const name = String(entry['name']).trim().toLowerCase();
    return `${basePath}constructionitem${name}.png`;
  }

  /**
   * Helper function to construct the URL for a castle image based on its type, level, and equipment.
   * @param castle The castle data containing type, level, and equipment information.
   * @param displayEquipment A boolean flag indicating whether to display the equipment image if available.
   * @returns The URL of the castle image, which may include the equipment image if displayEquipment is true and equipment data is available.
   */
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
    if (displayEquipment && castle.equipment && castle.equipment?.name) {
      const cleanName = castle.equipment?.name.toLowerCase().trim().replaceAll('\-_', '');
      // Special case for sand outpost which has a specific icon in the game assets
      const suffix = castle.type === CastleType.OUTPOST && cleanName === 'sand' ? 'sand802icon' : cleanName;
      return `${basePath}${eqName ?? path}special${suffix}.png`;
    }
    return `${basePath}${path}${level ? `level${level}.png` : 'basic.png'}`;
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
    this.applyFilterAndSort();
    this.cdr.detectChanges();
  }

  public isBuildingDistrict(entry: IMappedBuildingWithGround): boolean {
    return entry.data['isDistrict'] === '1';
  }

  /**
   * Helper function to retrieve all buildings that belong to the same district as the given building.
   * @param building The building for which to find other buildings in the same district. This building should have a 'districtTypeID' property in its data.
   * @returns An array of buildings that belong to the same district as the given building.
   */
  public getItemsInDistrict(building: IMappedBuildingWithGround): IMappedBuildingWithGround[] {
    if (this.isBuildingDistrict(building)) {
      const districtId = Number(building.data['districtTypeID']);
      return this.itemsInDistricts[districtId] || [];
    }
    return [];
  }

  /**
   * Helper function to construct the URL for a building image based on its name, type, group, and construction items.
   * This function is called from HTML templates to dynamically generate the image source for buildings in the castle view.
   * @param entry The building entry containing the name, type, group, and construction items of the building.
   * @returns The URL of the building image, which may vary based on the building's properties and construction items.
   */
  public getBuildingAssetUrl(entry: IMappedBuildingWithGround): string {
    const name = String(entry?.data?.['name']).trim().toLowerCase();
    const level = String(entry?.data?.['type']).trim().toLowerCase();
    const category = String(entry?.data?.['group']).trim().toLowerCase();
    const basePath = ApiRestService.apiUrl + 'assets/images/';
    let ressource;
    const levelIntWithoutLevel = Number.parseInt(level.replace('level', ''), 10);
    // This is a special case for walls, gates and towers which have a different naming convention
    // in the game assets based on their quality (basic/premium) instead of their level
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

  /**
   * Helper function to parse the effects of a building and return them as a comma-separated string.
   * @param effects The effects of the building, which can be a string, number, boolean, or null.
   * @returns A comma-separated string of effects, or '-' if the effects are invalid or empty.
   */
  public parseEffects(effects: string | number | boolean | null): string {
    if (!effects || typeof effects !== 'string') return '-';
    try {
      const parsed = JSON.parse(effects);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed.join(', ') : '-';
    } catch {
      return '-';
    }
  }

  /**
   * Helper function to construct the display name of a building based on its name, type, and group.
   * @param building The building for which to construct the display name
   * @returns The display name of the building, which is generated using a language key based on the building's properties.
   */
  public getBuildingName(building: IMappedBuildingWithGround): string {
    return this.getBuildingNameFromData(building.data);
  }

  /**
   * Helper function to construct the display name of a building based on its data properties.
   * @param data The building data containing the name, type, and group of the building.
   * @return The display name of the building, which is generated using a language key based on the building's data properties.
   */
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
    this.applyFilterAndSort();
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
    const search = this.search || this.calculatedCastleProperties.playerName;
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
      return accumulator + (Number(entry?.data?.[item]) || 0);
    }, 0);
    return sum;
  }

  public onClick(event: MouseEvent): void {
    if (!this.canvasReady) return;
    const hoveredBuilding = this.getBuildingAtMouseEvent(event);
    if (!hoveredBuilding) {
      this.tooltip = null;
      return;
    }
    this.searchTerm = '#' + hoveredBuilding.building.objectID;
    this.applyFilterAndSort();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    this.currentPage = 1;
    this.cdr.detectChanges();
  }

  public onMouseMove(event: MouseEvent): void {
    if (!this.canvasReady) return;
    const hoveredBuilding = this.getBuildingAtMouseEvent(event);
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

  private toMapped(entry: IMappedBuildingElement, isGround: boolean): IMappedBuildingWithGround {
    return { building: entry.building, data: entry.data, constructionItems: entry.constructionItems, isGround };
  }

  private addBuildingToDistrict(districtId: number, entry: IMappedBuildingWithGround): void {
    if (!this.itemsInDistricts[districtId]) {
      this.itemsInDistricts[districtId] = [];
    }
    this.itemsInDistricts[districtId].push(entry);
  }

  /**
   * Computes the grid metrics for the castle map based on the visible area defined by minX, minY, maxX, and maxY.
   * This sets `cellSize`, `offsetX`, and `offsetY` which are used to render the buildings on the canvas correctly.
   * @param canvas The HTML canvas element used to render the castle map.
   */
  private computeGridMetrics(canvas: HTMLCanvasElement): void {
    const visibleWidth = this.maxX - this.minX;
    const visibleHeight = this.maxY - this.minY;
    const cellSize = Math.min(canvas.width / visibleWidth, canvas.height / visibleHeight);
    const roundedTo2Decimals = Math.round(cellSize * 100) / 100;

    this.cellSize = roundedTo2Decimals;
    this.offsetX = (canvas.width - visibleWidth * roundedTo2Decimals) / 2;
    this.offsetY = (canvas.height - visibleHeight * roundedTo2Decimals) / 2;
  }

  /**
   * Computes the minimum and maximum X and Y coordinates for the castle map based on the positions and dimensions of the floor tiles.
   * It iterates through all the floor tiles, calculates their boundaries, and updates the min and max coordinates accordingly.
   * This sets the `minX`, `minY`, `maxX`, and `maxY` properties which define the visible area of the castle map.
   * @param marginCells An optional number of cells to add as a margin around the computed bounds, default is 3.
   */
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

  private getPlaceOccupiedByAllBuildings(): number {
    return this.buildings.reduce((total, entry) => {
      if (!entry) return total;
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

  private drawBuildings(): void {
    this.computeGridMetrics(this.canvasRef.nativeElement);
    const context = this.canvasRef.nativeElement.getContext('2d');
    if (!context) return;
    const canvas = this.canvasRef.nativeElement;
    context.clearRect(0, 0, canvas.width, canvas.height);
    ViewCastleUtilities.drawFloorPerimeter(
      context,
      this.castleObject,
      this.offsetX,
      this.offsetY,
      this.minX,
      this.minY,
      this.cellSize,
    );
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
      const x = ViewCastleUtilities.roundedTo2Decimals(this.offsetX + (positionX - this.minX) * this.cellSize);
      const y = ViewCastleUtilities.roundedTo2Decimals(this.offsetY + (positionY - this.minY) * this.cellSize);
      const w = ViewCastleUtilities.roundedTo2Decimals(width * this.cellSize);
      const h = ViewCastleUtilities.roundedTo2Decimals(height * this.cellSize);
      if (entry.isGround) {
        const colors = ['#000000ff', '#3a2121ff'];
        context.fillStyle = colors[0];
        context.fillRect(x, y, w, h);
      } else {
        const nameElement = entry.data?.['name'] ?? 'Unknown';
        const [color] = ViewCastleUtilities.getItemColor(String(nameElement));
        ViewCastleUtilities.drawCellModern(context, x, y, w, h, color);
      }
    }
    this.cdr.detectChanges();
  }

  /**
   * Gets the public order value for a building,
   * prioritizing deco points if available, otherwise calculating it based on fusion level.
   * @param building Building data element
   * @returns Public order value for the building
   */
  private getPublicOrderOfBuilding(building: IMappedBuildingUnknownDataElement): number {
    if (building['decoPoints']) return Number.parseInt(String(building['decoPoints']));
    return this.getFusionLevelPublicOrder(String(building['initialFusionLevel']));
  }

  /**
   * Gets the public order value based on the fusion level of a building.
   * This is an ingame mechanic where higher fusion levels provide more public order.
   * The formula is : 100 + (fusion level * 5)
   * @param level Fusion level of the building
   * @returns Calculated public order value based on fusion level
   */
  private getFusionLevelPublicOrder(level: string | number): number {
    const parsedLevel = Number.parseInt(String(level));
    if (!Number.isNaN(parsedLevel)) {
      return 100 + parsedLevel * 5;
    }
    return 0;
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

  /**
   * Generates the raw building name key used for localization lookup
   * This code is based on the observed patterns in the game's source
   * code and may need adjustments if the game's localization system changes.
   * @param bt Building type
   * @param ky Key
   * @param gp Group
   * @returns Raw building name key
   */
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

  private getFormatedLevel(level: number, legendaryLevel: number): string {
    return level === 70 ? `${level}/${legendaryLevel}` : `${level}`;
  }

  private applyFilterAndSort(): void {
    let filtered = this.visibleBuildings;
    if (this.searchTerm.trim()) {
      const lower = this.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          String(m.building.wodID).toLowerCase().includes(lower) ||
          String(m.data['translatedName']).toLowerCase().includes(lower) ||
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
              ('' + aValue).localeCompare('' + bValue, undefined, { sensitivity: 'base' }) * (this.sortAsc ? 1 : -1)
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
    console.log(this._filteredBuildings);
    this._filteredBuildings = filtered;
  }

  public get paginatedBuildings(): IMappedBuildingWithGround[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this._filteredBuildings.slice(start, start + this.pageSize);
  }

  public get galleryBuildings(): IMappedBuildingWithGround[] {
    return this._filteredBuildings;
  }

  private computeCastleProperties(): void {
    if (!this.castleObject) return;
    const allBuildings = [
      ...this.castleObject.data.buildings,
      ...this.castleObject.data.defenses,
      ...this.castleObject.data.gates,
      ...this.castleObject.data.towers,
    ];
    let sumMight = 0;
    let sumPublicOrder = 0;
    let wallCount = 0;
    let guardSize = 0;
    for (const entry of allBuildings) {
      sumMight += Number(entry?.data?.['mightValue']) || 0;
      sumPublicOrder += Number(entry?.data?.['publicOrder']) || 0;
      wallCount += Number(entry?.data?.['unitWallCount']) || 0;
      guardSize += Number(entry?.data?.['guardSize']) || 0;
    }
    const placeOccupied = this.getPlaceOccupiedByAllBuildings();
    this.calculatedCastleProperties = {
      playerName: this.castleObject.playerName ?? '-',
      castleName: this.castleObject.castleName ?? '-',
      castleType: this.getCastleType(this.castleObject.castleType),
      level: this.getFormatedLevel(this.castleObject.level, this.castleObject.legendaryLevel ?? 0),
      positionX: this.castleObject.positionX,
      positionY: this.castleObject.positionY,
      publicOrder: {
        base: this.calculatedCastleProperties?.publicOrder.base + sumPublicOrder,
        effects: this.calculatedCastleProperties?.publicOrder.effects,
      },
      sightRadius: this.calculatedCastleProperties?.sightRadius,
      sumMight,
      guardSize,
      wall: {
        base: this.calculatedCastleProperties?.wall.base + wallCount,
        effects: this.calculatedCastleProperties?.wall.effects,
      },
      placeOccupied,
      placeNotOccupied: this.getTotalMapArea() - placeOccupied,
      nbFloors: this.castleObject.data.grounds.length,
      maxFloors: this.calculatedCastleProperties?.maxFloors ?? 0,
      nbFire: this.getFireCount(),
    };
  }

  private async mapCastleJson(castleData: ApiPlayerCastleDataResponse): Promise<void> {
    const castleJsonData = await this.fetchCastleJsonItems();
    this.effects = castleJsonData['effects'];
    this.effectTypes = castleJsonData['effecttypes'];
    this.languageJsonData = ViewCastleUtilities.upperAllKeys(await this.fetchGgeLanguage());
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
    console.log(this.regroupedEffects);

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
    this.regroupedEffects = [];
    const mappedGrounds = result.data.grounds.map((g) => this.toMapped(g, true));
    const mappedBuildings = result.data.buildings.map((b) => this.toMapped(b, false));
    this.grounds = mappedGrounds;
    this.buildings = [...mappedGrounds, ...mappedBuildings];
    this.visibleBuildings = [
      ...result.data.gates.map((g) => this.toMapped(g, false)),
      ...result.data.defenses.map((d) => this.toMapped(d, false)),
      ...mappedBuildings,
      ...result.data.towers.map((t) => this.toMapped(t, false)),
    ];
    const keepElement = this.visibleBuildings.filter((b) => b && String(b.data['name']) === 'Keep');
    this.visibleBuildings = [
      ...keepElement,
      ...this.visibleBuildings.filter((b) => b && String(b.data['name']) !== 'Keep'),
    ];
    this.applyFilterAndSort();
    this.computeCastleProperties();
    this.isInLoading = false;
    this.cdr.detectChanges();
    this.computeMapBoundsFromFloor();
    this.allVisibleBuildings = [...this.visibleBuildings];
    const seenTypes = new Set<string>();
    this.constructionTypes = this.visibleBuildings
      .filter((b) => b.data['buildingGroundType'])
      .map((b) => ({ label: String(b.data['buildingGroundType']), value: String(b.data['buildingGroundType']) }))
      .filter(({ value }) => {
        if (seenTypes.has(value)) return false;
        seenTypes.add(value);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    this.constructionTypes.unshift({ label: this.translations['Tous'], value: null });
    this.drawBuildings();
  }

  private async translateKeys(): Promise<void> {
    const keys = Object.keys(this.translations) as (keyof typeof this.translations)[];
    const values = await Promise.all(keys.map((key) => this.translateService.get(key).toPromise()));
    for (const [index, key] of keys.entries()) {
      this.translations[key] = values[index];
    }
  }

  private async fetchRandomCastles(): Promise<void> {
    const castleJsonData = await this.fetchCastleJsonItems();
    const castleResponse = await this.apiRestService.getRandomCastles();
    if (!castleResponse.success) {
      this.cdr.detectChanges();
      return;
    }
    this.castles = castleResponse.data.map((castle) => ({
      ...castle,
      equipment: castle.equipmentUniqueIdSkin
        ? this.getSkinFromUniqueId(castleJsonData, String(castle.equipmentUniqueIdSkin))
        : null,
    }));
    this.cdr.detectChanges();
    this.drawMiniMaps();
    this.cdr.detectChanges();
  }

  private getBuildingAtMouseEvent(event: MouseEvent): IMappedBuildingWithGround | null {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    const cellX = Math.floor((canvasX - this.offsetX) / this.cellSize) + this.minX;
    const cellY = Math.floor((canvasY - this.offsetY) / this.cellSize) + this.minY;
    return (
      this.buildings.find((b) => {
        if (!b || b.isGround) return false;
        const { positionX: x, positionY: y, rotation } = b.building;
        const originalW = Number.parseInt(String(b.data?.['width']));
        const originalH = Number.parseInt(String(b.data?.['height']));
        const w = rotation === 1 ? originalH : originalW;
        const h = rotation === 1 ? originalW : originalH;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return false;
        return cellX >= x && cellX < x + w && cellY >= y && cellY < y + h;
      }) ?? null
    );
  }

  private mapDataObject(data: IMappedBuildingUnknownDataElement): IMappedBuildingUnknownDataElement {
    if (!this.languageJsonData) throw new Error('Language JSON data is not loaded');
    const effects: string[] = this.getAreaSpecificEffects(data);
    return {
      ...data,
      mightValue: Number(data['mightValue']) || 0,
      level: Number(data['level']) || 0,
      publicOrder: this.getPublicOrderOfBuilding(data),
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
    return `/assets/ci/${this.getBaseNameTextId(String(data['slotTypeID']))}_${ViewCastleComponent.RARENESS_NAMES[Number(data['rarenessID'])] || 'unknown'}.png`.toLowerCase();
  }

  private toHex(value: number): string {
    return '#' + value.toString(16).padStart(6, '0');
  }

  private mapConstructionItemObject(data: IMappedBuildingUnknownDataElement): IMappedBuildingUnknownDataElement {
    try {
      const RARENESS_COLORS = ViewCastleComponent.RARENESS_COLORS;
      const RARENESS_NAMES = ViewCastleComponent.RARENESS_NAMES;
      if (!this.languageJsonData) {
        throw new Error('Language JSON data is not loaded');
      }
      const splittedEffects = data['effects'] ? String(data['effects']).split(',') : [];
      let effects: { effectId: string; effectTypeID: string; raw: string; value: number; name: string }[] = [];

      // Handle deco points effect if present, as it's a common public order source for construction items
      if (data['decoPoints']) {
        const name = this.languageJsonData['ci_effect_decoPoints'.toUpperCase()];
        effects.push({
          effectId: 'decoPoints',
          effectTypeID: 'decoPoints',
          raw: name as string,
          value: Number(data['decoPoints']),
          name: (name as string).replace('{0}', String(data['decoPoints'])),
        });
        this.calculatedCastleProperties.publicOrder.effects += Number(data['decoPoints']);
      }

      // Handle legacy effects that are directly present as fields in the data object
      // This is an in-game mechanic where some effects are not included in the 'effects'
      // field but are instead represented as separate fields in the building data
      const legacyEffectFields: [string, boolean][] = this.getLegacyEffects();
      for (const [key] of legacyEffectFields) {
        if (data[key] !== undefined) {
          const count = data[key];
          const name = this.languageJsonData[('ci_effect_' + key).toUpperCase()];
          effects.push({
            raw: name as string,
            effectId: key,
            effectTypeID: key,
            value: Number(count),
            name: (name as string).replace('{0}', String(count)),
          });
        }
      }

      // Handle regular effects defined in the 'effects' field
      for (const splittedEffect of splittedEffects) {
        const [effectId, effectValue] = splittedEffect ? splittedEffect.split('&') : [null, null];
        let effectCode = this.effects.find((effect) => effect['effectID'] === effectId);
        if (splittedEffect && effectValue !== null) {
          const key = effectCode && effectCode['name'];
          const name = this.languageJsonData[('equip_effect_description_' + key).toUpperCase()];
          if (name) {
            effects.push({
              effectId: effectCode?.['effectID'] || 'unknown',
              effectTypeID: effectCode?.['effectTypeID'] || 'unknown',
              raw: name as string,
              value: Number(effectValue),
              name: (name as string).replace('{0}', String(effectValue)),
            });
          } else {
            const name = this.languageJsonData[('ci_effect_' + key).toUpperCase()];
            if (name) {
              effects.push({
                effectId: effectCode?.['effectID'] || 'unknown',
                effectTypeID: effectCode?.['effectTypeID'] || 'unknown',
                raw: name as string,
                value: Number(effectValue),
                name: (name as string).replace('{0}', String(effectValue)),
              });
            } else {
              const target = effectValue.split('+');
              effects.push({
                effectId: effectCode?.['effectID'] || 'unknown',
                effectTypeID: effectCode?.['effectTypeID'] || 'unknown',
                raw: this.languageJsonData[('ci_effect_' + key + '_' + target[0]).toUpperCase()] as string,
                value: Number(target[1]),
                name: (this.languageJsonData[('ci_effect_' + key + '_' + target[0]).toUpperCase()] as string).replace(
                  '{0}',
                  String(target[1]),
                ),
              });
            }
          }
        }
      }
      for (const effect of effects) {
        const name = this.capitalizeFirstLetter(
          String(effect['raw'])
            .trim()
            .replaceAll(/\+?-?{0\}%?\s*/g, '')
            .toLowerCase(),
        );
        const regroupedEffect = this.regroupedEffects.find(
          (regroupedEffect) => regroupedEffect['effectId'] == effect['effectId'] || effect['name'] === name,
        );
        const unitWallAbsoluteAmount = new Set(['194']); // ID: unitWallAbsoluteAmount
        if (unitWallAbsoluteAmount.has(effect['effectTypeID'] || '')) {
          if (String(effect['raw']).includes('%')) {
            this.calculatedCastleProperties.wall.effects +=
              (this.calculatedCastleProperties.wall.base * Number(effect['value'])) / 100;
          } else {
            this.calculatedCastleProperties.wall.base += Number(effect['value']) || 0;
          }
        }
        if (!regroupedEffect) {
          this.regroupedEffects.push({
            name: name,
            effectId: effect['effectId'] || 'unknown',
            type: String(effect['raw']).includes('%') ? 'percentage' : 'flat',
            value: Number(effect['value']) || 0,
          });
        } else if (regroupedEffect) {
          regroupedEffect.value += Number(effect['value']) || 0;
        } else {
          console.error('Effect code not found for effectId:', effect, data['effects'], data);
        }
      }
      const mappedEffectNames = effects.map((effect) => effect.name).join(', ');

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
        rarenessColor: this.toHex(RARENESS_COLORS[Number(data['rarenessID']) as keyof typeof RARENESS_COLORS] || 0),
        translatedName: String(
          this.languageJsonData[
            (this.getBaseNameTextId(String(data['slotTypeID'])) + '_' + data['name'] || 'unknown').toUpperCase()
          ],
        ),
        boxUrl: this.getBoxUrl(data),
        effect: mappedEffectNames || null,
      };
    } catch (error) {
      console.error('Error in transformData:', error);
      return { ...data, effect: null };
    }
  }

  private getLegacyEffects(): [string, boolean][] {
    return [
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
  }

  private getColorMap(castle: ApiPlayerCastleNameResponse): [string, string] {
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
      default: {
        return ['#888888', '#0e0e0e56'];
      }
    }
  }

  private drawMiniMaps(): void {
    this.miniMaps.forEach((canvasReference, index) => {
      const castle = this.castles[index];
      const context = canvasReference.nativeElement.getContext('2d');
      if (!context) return;
      const [bgColor, dotColor] = this.getColorMap(castle);
      context.clearRect(0, 0, this.miniSize, this.miniSize);
      context.fillStyle = bgColor;
      context.fillRect(0, 0, this.miniSize, this.miniSize);
      const x = (castle.positionX / this.mapSize) * this.miniSize;
      const y = (castle.positionY / this.mapSize) * this.miniSize;
      context.fillStyle = dotColor;
      context.beginPath();
      context.arc(x, y, 3, 0, 2 * Math.PI);
      context.fill();
      context.strokeStyle = dotColor;
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
        let name: string = '';
        const tries = ['effect_name_' + findEffect['name'], 'equip_effect_description_' + findEffect['name']];
        effects[index] = null;
        let currentName: string | null = effects[index];
        for (const tryKey of tries) {
          if (currentName) break;
          name = this.languageJsonData[tryKey.toUpperCase()] as string;
          if (name) {
            const searchType = this.effectTypes.find(
              (effectType) => effectType['effectTypeID'] === findEffect['effectTypeID'],
            );
            const ciEffectName = this.languageJsonData[('ci_effect_' + searchType!['name']).toUpperCase()];
            if (ciEffectName) {
              currentName = String(ciEffectName).replace('{0}', value);
            } else {
              const target = value.split('+');
              if (target.length === 2) {
                currentName = this.languageJsonData[
                  ('ci_effect_' + searchType!['name'] + '_' + target[0]).toUpperCase()
                ] as string;
              } else if (name.includes('{0}')) {
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
        if (!currentName) {
          const searchType = this.effectTypes.find(
            (effectType) => effectType['effectTypeID'] === findEffect['effectTypeID'],
          );
          const target = value.split('+');
          if (target.length === 2) {
            name = this.languageJsonData[
              ('ci_effect_' + searchType!['name'] + '_' + target[0]).toUpperCase()
            ] as string;
            currentName = name ? String(name).replace('{0}', target[1]) : null;
          }
        }
        effects[index] = currentName;
        if (currentName) {
          const effect = currentName.includes('%') ? 'percentage' : 'flat';
          const parsedName = name
            .toLowerCase()
            .replaceAll(/\+?-?{0\}%?\s*/g, '')
            .trim();
          const item = {
            name: this.capitalizeFirstLetter(parsedName),
            effectId: findEffect['effectID'],
            value: Number(value),
            type: effect,
          };
          const bonusWallDefenseTroopCapacityEffectId = new Set(['12']); // ID: defenseUnitAmountWallCapped
          const sightRadiusBonusEffectId = new Set(['59']); // ID: SightRadiusBonus
          if (bonusWallDefenseTroopCapacityEffectId.has(findEffect['effectTypeID'])) {
            this.calculatedCastleProperties.wall.effects += Number(value);
          } else if (sightRadiusBonusEffectId.has(findEffect['effectTypeID'])) {
            this.calculatedCastleProperties.sightRadius += Number(value);
          }
          const existing = this.regroupedEffects.find(
            (effect) => effect.name === item.name && effect.effectId === item.effectId,
          );
          if (existing) {
            existing.value += item.value;
          } else {
            this.regroupedEffects.push(item);
          }
        } else {
          const searchType = this.effectTypes.find(
            (effectType) => effectType['effectTypeID'] === findEffect['effectTypeID'],
          );
          console.warn(`Effect name for ${findEffect['name']} not found in language data.`, searchType, data, value);
        }
      }
      return effects.filter((effect: string | null) => effect !== null && effect !== undefined) as string[];
    }
  }
}
