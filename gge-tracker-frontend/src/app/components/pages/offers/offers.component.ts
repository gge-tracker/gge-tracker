import { NgClass } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchbarComponent } from '@ggetracker-components/searchbar/searchbar.component';
import { SelectComponent } from '@ggetracker-components/select/select.component';
import {
  ApiOffer,
  ApiOfferCategory,
  ApiOfferReward,
  ApiOffersCatalogResponse,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { ServerService } from '@ggetracker-services/server.service';
import { CurrencyPickerComponent } from './currency-picker/currency-picker.component';
import { buildCurrencyOptions, currencyForServer, OfferCurrencyOption, OFFER_CURRENCIES } from './offer-currencies';
import { OfferEffect, parseRewardDescription } from './offer-effects';
import { TranslateModule } from '@ngx-translate/core';
import {
  ChevronLeft,
  ChevronRight,
  Gem,
  LucideAngularModule,
  RefreshCw,
  Search,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-angular';

interface OfferReward {
  title: string;
  description: string | null;
  quantity: string | null;
  iconUrl: string | null;
  effects: OfferEffect[];
  notes: string[];
  size: string | null;
  isDetailed: boolean;
}

interface OfferCard {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  price: number;
  formattedPrice: string;
  currency: string;
  isFree: boolean;
  bonusPercent: number | null;
  rubies: number | null;
  rubiesPerUnit: number | null;
  rewards: OfferReward[];
  isSpecial: boolean;
  isPurchased: boolean;
}

interface OfferCategory {
  key: string;
  label: string;
  offers: OfferCard[];
}

interface OfferTab {
  special: boolean;
  key: string;
  label: string;
  count: number;
}

interface OfferSkeleton {
  lines: number[];
}

type OfferSort = '' | 'price-asc' | 'price-desc';

@Component({
  selector: 'app-offers',
  imports: [
    NgClass,
    FormsModule,
    TranslateModule,
    LucideAngularModule,
    SearchbarComponent,
    SelectComponent,
    CurrencyPickerComponent,
    FormatNumberPipe,
  ],
  standalone: true,
  templateUrl: './offers.component.html',
  styleUrl: './offers.component.css',
})
export class OffersComponent extends GenericComponent implements OnInit, AfterViewInit, OnDestroy {
  public readonly Search = Search;
  public readonly X = X;
  public readonly RefreshCw = RefreshCw;
  public readonly Sparkles = Sparkles;
  public readonly Gem = Gem;
  public readonly ChevronLeft = ChevronLeft;
  public readonly ChevronRight = ChevronRight;
  public readonly Smartphone = Smartphone;

  public readonly maxLevel = 70;
  public readonly maxLegendaryLevel = 950;
  public readonly minimumEffectsForDetail = 2;
  public readonly allCategoryKey = '__all__';
  public readonly defaultSkeletonCount = 8;
  public readonly maxSkeletonCount = 12;

  public categories: OfferCategory[] = [];
  public tabs: OfferTab[] = [];
  public displayedOffers: OfferCard[] = [];
  public selectedCategory: string = this.allCategoryKey;
  public failedCategories: string[] = [];
  public expandedOffers = new Set<string>();
  public overflowingOffers = new Set<string>();
  public canScrollTabsBack = false;
  public canScrollTabsForward = false;

  public level = 70;
  public legendaryLevel = 950;
  public currency = '';
  public search: string | null = null;
  public orderBy: OfferSort = '';
  public refreshDataAnimationSpinner = false;
  public isRefreshing = false;
  public skeletonCards: OfferSkeleton[] = [];

  public sorts: { label: string; value: string }[] = [];
  public currencyOptions: OfferCurrencyOption[] = [];
  public serverCurrency = '';

  private readonly sortLabels: Record<OfferSort, string> = {
    '': 'Ordre de la boutique',
    'price-asc': 'Prix croissant',
    'price-desc': 'Prix décroissant',
  };

  private readonly categoryLabels: Record<string, string> = {
    cashoffers: "Lots d'avantages",
    supersale: 'Super offre',
    hcbundles: 'Lots de rubis',
    eventoffers: "Lots d'événement",
    promos: 'Packs de promotion',
    hardCurrency: 'Rubis',
    dailybundles: 'Lots du jour',
    piggybank: 'Événement de fidélité',
    'growth-fund': 'Lots de croissance',
    subscriptions: 'Abonnements',
  };

  @ViewChildren('cardContent') private readonly cardContents!: QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('cardFlow') private readonly cardFlows!: QueryList<ElementRef<HTMLElement>>;

  private allOffers: OfferCard[] = [];
  private tabStrip?: HTMLElement;
  private tabsObserver?: ResizeObserver;

  private readonly localStorage = inject(LocalStorageService);
  private readonly serverService = inject(ServerService);
  private readonly cdr = inject(ChangeDetectorRef);
  private flowObserver?: ResizeObserver;
  private measureScheduled = false;

  constructor() {
    super();
    this.level = this.readStoredNumber('offersLevel', this.level, 1, this.maxLevel);
    this.legendaryLevel = this.readStoredNumber('offersLegendaryLevel', this.legendaryLevel, 0, this.maxLegendaryLevel);
    this.serverCurrency = currencyForServer(this.serverService.currentServer?.name);
    this.currencyOptions = buildCurrencyOptions(this.langageService.getCurrentLocale());
    this.currency = this.readStoredCurrency();
  }

  public ngOnInit(): void {
    void this.getData();
  }

  @ViewChild('tabStrip')
  public set tabStripElement(reference: ElementRef<HTMLElement> | undefined) {
    this.tabStrip = reference?.nativeElement;
    this.observeTabStrip();
  }

  public ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    if (typeof ResizeObserver !== 'undefined') {
      this.flowObserver = new ResizeObserver(() => this.scheduleOverflowMeasure());
    }
    this.cardFlows.changes.subscribe(() => this.observeFlows());
    this.observeFlows();
  }

  public ngOnDestroy(): void {
    this.flowObserver?.disconnect();
    this.tabsObserver?.disconnect();
  }

  public get totalOffersCount(): number {
    return this.allOffers.length;
  }

  public get isBusy(): boolean {
    return this.isInLoading || this.isRefreshing;
  }

  public get isE4kServer(): boolean {
    return this.serverService.isE4kServer();
  }

  public async getData(withSkeletons = false): Promise<void> {
    if (this.isE4kServer) {
      this.isInLoading = false;
      this.isRefreshing = false;
      this.refreshDataAnimationSpinner = false;
      return;
    }
    if (withSkeletons) {
      this.buildSkeletons();
      this.isRefreshing = true;
    } else {
      this.isInLoading = true;
    }
    this.sorts = Object.entries(this.sortLabels).map(([value, label]) => ({
      label: this.translateService.instant(label),
      value,
    }));
    const response = await this.apiRestService.getOffers(
      this.level,
      this.legendaryLevel,
      this.currentLang,
      this.currency,
    );
    this.isInLoading = false;
    this.isRefreshing = false;
    this.refreshDataAnimationSpinner = false;
    if (!response.success) {
      this.categories = [];
      this.allOffers = [];
      this.tabs = [];
      this.selectedCategory = this.allCategoryKey;
      this.toastService.add(response.error || ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.categories = this.buildCategories(response.data);
    this.allOffers = this.buildAllOffers(this.categories);
    this.tabs = this.buildTabs(this.categories);
    this.failedCategories = Object.keys(response.data._failed ?? {});
    this.expandedOffers.clear();
    if (!this.tabs.some((tab) => tab.key === this.selectedCategory)) {
      this.selectedCategory = this.allCategoryKey;
    }
    this.applyFilters();
    this.scheduleTabsOverflowUpdate();
  }

  public applyFilters(): void {
    const source =
      this.selectedCategory === this.allCategoryKey
        ? this.allOffers
        : this.categories.find((entry) => entry.key === this.selectedCategory)?.offers;
    if (!source) {
      this.displayedOffers = [];
      return;
    }
    const search = this.search?.trim().toLowerCase();
    const offers = search
      ? source.filter(
          (offer) =>
            offer.name.toLowerCase().includes(search) ||
            offer.rewards.some((reward) => reward.title.toLowerCase().includes(search)),
        )
      : [...source];
    switch (this.orderBy) {
      case 'price-asc': {
        offers.sort((a, b) => a.price - b.price);
        break;
      }
      case 'price-desc': {
        offers.sort((a, b) => b.price - a.price);
        break;
      }
    }
    this.displayedOffers = offers;
  }

  public refresh(): void {
    this.refreshDataAnimationSpinner = true;
    void this.getData(true);
  }

  public scrollTabs(direction: -1 | 1): void {
    const strip = this.tabStrip;
    if (!strip) return;
    strip.scrollBy({ left: direction * Math.max(strip.clientWidth * 0.7, 180), behavior: 'smooth' });
  }

  public updateTabsOverflow(): void {
    const strip = this.tabStrip;
    if (!strip) return;
    const remaining = strip.scrollWidth - strip.clientWidth - strip.scrollLeft;
    const back = strip.scrollLeft > 1;
    const forward = remaining > 1;
    if (back === this.canScrollTabsBack && forward === this.canScrollTabsForward) return;
    this.canScrollTabsBack = back;
    this.canScrollTabsForward = forward;
    this.cdr.detectChanges();
  }

  public selectCategory(key: string, event?: Event): void {
    (event?.currentTarget as HTMLElement | undefined)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
    if (this.selectedCategory === key) return;
    this.selectedCategory = key;
    this.expandedOffers.clear();
    this.applyFilters();
  }

  public changeSort(value: string | null): void {
    this.orderBy = (value ?? '') as OfferSort;
    this.applyFilters();
  }

  public changeCurrency(value: string): void {
    const currency = OFFER_CURRENCIES.find((entry) => entry.code === value)?.code;
    if (!currency || currency === this.currency) return;
    this.currency = currency;
    this.localStorage.setItem('offersCurrency', currency);
    void this.getData(true);
  }

  public onSearchChange(value: string): void {
    this.search = value;
    this.applyFilters();
  }

  public onLevelChange(value: string): void {
    this.level = this.clamp(Number.parseInt(value), 1, this.maxLevel, this.level);
    this.localStorage.setItem('offersLevel', String(this.level));
  }

  public onLegendLevelChange(value: string): void {
    this.legendaryLevel = this.clamp(Number.parseInt(value), 0, this.maxLegendaryLevel, this.legendaryLevel);
    this.localStorage.setItem('offersLegendaryLevel', String(this.legendaryLevel));
  }

  public resetSearch(): void {
    this.search = null;
    this.applyFilters();
  }

  public toggleCard(offerId: string): void {
    if (this.expandedOffers.has(offerId)) {
      this.expandedOffers.delete(offerId);
    } else {
      this.expandedOffers.add(offerId);
    }
  }

  public isExpanded(offerId: string): boolean {
    return this.expandedOffers.has(offerId);
  }

  public isClipped(offerId: string): boolean {
    return this.overflowingOffers.has(offerId);
  }

  public categoryLabel(key: string): string {
    return this.categoryLabels[key] ?? key;
  }

  private buildSkeletons(): void {
    const shown = this.displayedOffers.length > 0 ? this.displayedOffers.length : this.defaultSkeletonCount;
    const count = Math.min(Math.max(shown, 4), this.maxSkeletonCount);
    this.skeletonCards = Array.from({ length: count }, (_, index) => ({
      lines: Array.from({ length: 2 + (index % 2) }, (_, line) => line),
    }));
  }

  private buildCategories(catalog: ApiOffersCatalogResponse): OfferCategory[] {
    const categories: OfferCategory[] = [];
    for (const [key, value] of Object.entries(catalog)) {
      if (key === '_failed') continue;
      const offers = (value as ApiOfferCategory)?.data?.offers;
      if (!Array.isArray(offers) || offers.length === 0) continue;
      categories.push({
        key,
        label: this.categoryLabel(key),
        offers: offers.map((offer) => this.buildOffer(offer)),
      });
    }
    return categories;
  }

  private buildAllOffers(categories: OfferCategory[]): OfferCard[] {
    const offers = new Map<string, OfferCard>();
    for (const category of categories) {
      for (const offer of category.offers) {
        if (!offers.has(offer.id)) offers.set(offer.id, offer);
      }
    }
    return [...offers.values()];
  }

  private buildTabs(categories: OfferCategory[]): OfferTab[] {
    if (categories.length === 0) return [];
    return [
      { key: this.allCategoryKey, label: 'Tous', special: false, count: this.allOffers.length },
      ...categories
        .map((category) => ({
          key: category.key,
          label: category.label,
          special: category.key === 'promos',
          count: category.offers.length,
        }))
        .sort((n) => (n.key === 'promos' ? -1 : 1)),
    ];
  }

  private buildOffer(offer: ApiOffer): OfferCard {
    const currency = offer.currencyCode ?? offer.currency ?? '';
    const price = Number(offer.price) || 0;
    const rubies = this.getRubies(offer);
    const rewards = (offer.rewards ?? []).map((reward) => this.buildReward(reward));
    return {
      id: String(offer.id),
      name: (offer.name ?? offer.title ?? '').replaceAll('\n', ' ').trim(),
      description: offer.desc ?? null,
      image: offer.teaserImg ?? offer.headerImageUrl ?? null,
      price,
      formattedPrice: this.formatPrice(price, currency),
      currency,
      isFree: price === 0,
      bonusPercent: offer.bonus && offer.bonus > 0 ? offer.bonus : null,
      rubies,
      rubiesPerUnit: rubies && price > 0 ? Math.round(rubies / (price / 100)) : null,
      rewards,
      isSpecial: offer.special === true,
      isPurchased: offer.purchased === true,
    };
  }

  private buildReward(reward: ApiOfferReward): OfferReward {
    const description = reward.desc?.trim() || null;
    const parsed = description
      ? parseRewardDescription(description, this.langageService.getCurrentLocale())
      : { effects: [], notes: [], size: null };
    const quantity = reward.details ?? (reward.qty && reward.qty > 1 ? `x${reward.qty}` : null);
    return {
      title: reward.title ?? '',
      description,
      quantity: parsed.effects.some((effect) => this.sameNumber(effect.value, quantity)) ? null : quantity,
      iconUrl: reward.iconUrl || null,
      effects: parsed.effects,
      notes: parsed.notes,
      size: parsed.size,
      isDetailed: parsed.effects.length >= this.minimumEffectsForDetail,
    };
  }

  private sameNumber(left: string, right: string | null): boolean {
    if (!right) return false;
    const leftDigits = left.replaceAll(/\D/g, '');
    return leftDigits.length > 0 && leftDigits === right.replaceAll(/\D/g, '');
  }

  private getRubies(offer: ApiOffer): number | null {
    if (offer.hardCurrencyAmount) return offer.hardCurrencyAmount;
    if (offer.bonusHCValue) return offer.bonusHCValue;
    const premium = (offer.rewards ?? []).find((reward) => reward.type === 'currencyPremium');
    return premium?.qty ?? null;
  }

  private formatPrice(price: number, currency: string): string {
    if (price === 0) return this.translateService.instant('Gratuit');
    try {
      return new Intl.NumberFormat(this.langageService.getCurrentLocale(), {
        style: 'currency',
        currency,
      }).format(price / 100);
    } catch {
      return `${(price / 100).toFixed(2)} ${currency}`.trim();
    }
  }

  private observeTabStrip(): void {
    this.tabsObserver?.disconnect();
    if (!this.isBrowser || !this.tabStrip || typeof ResizeObserver === 'undefined') return;
    this.tabsObserver ??= new ResizeObserver(() => this.updateTabsOverflow());
    this.tabsObserver.observe(this.tabStrip);
    this.scheduleTabsOverflowUpdate();
  }

  private scheduleTabsOverflowUpdate(): void {
    if (!this.isBrowser) return;
    setTimeout(() => this.updateTabsOverflow());
  }

  private observeFlows(): void {
    this.flowObserver?.disconnect();
    for (const flow of this.cardFlows) this.flowObserver?.observe(flow.nativeElement);
    this.scheduleOverflowMeasure();
  }

  private scheduleOverflowMeasure(): void {
    if (!this.isBrowser || this.measureScheduled) return;
    this.measureScheduled = true;
    setTimeout(() => {
      this.measureScheduled = false;
      this.measureOverflow();
    });
  }

  private measureOverflow(): void {
    const overflowing = new Set<string>();
    const windows = new Map<string, HTMLElement>();
    for (const content of this.cardContents) {
      const offerId = content.nativeElement.dataset['offer'];
      if (offerId) windows.set(offerId, content.nativeElement);
    }
    for (const flow of this.cardFlows) {
      const element = flow.nativeElement;
      const offerId = element.dataset['offer'];
      const window = offerId ? windows.get(offerId) : undefined;
      if (!offerId || !window) continue;
      const clipped = this.expandedOffers.has(offerId)
        ? this.overflowingOffers.has(offerId)
        : element.offsetHeight - window.clientHeight > 2;
      if (clipped) overflowing.add(offerId);
    }
    if (overflowing.size === this.overflowingOffers.size && [...overflowing].every((id) => this.isClipped(id))) {
      return;
    }
    this.overflowingOffers = overflowing;
    this.cdr.detectChanges();
  }

  private readStoredCurrency(): string {
    const stored = this.localStorage.getItem('offersCurrency');
    if (stored && OFFER_CURRENCIES.some((entry) => entry.code === stored)) return stored;
    return this.serverCurrency;
  }

  private readStoredNumber(key: string, fallback: number, min: number, max: number): number {
    return this.clamp(Number.parseInt(this.localStorage.getItem(key) ?? ''), min, max, fallback);
  }

  private clamp(value: number, min: number, max: number, fallback: number): number {
    if (Number.isNaN(value)) return fallback;
    return Math.min(Math.max(value, min), max);
  }
}
