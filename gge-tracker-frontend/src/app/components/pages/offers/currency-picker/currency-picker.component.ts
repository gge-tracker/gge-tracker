/* eslint-disable unicorn/consistent-function-scoping */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Check, ChevronDown, LucideAngularModule, Search } from 'lucide-angular';
import { OfferCurrencyOption } from '../offer-currencies';

function filterCurrencies(items: OfferCurrencyOption[], search: string): OfferCurrencyOption[] {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter(
    (item) =>
      item.code.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query) ||
      item.symbol.toLowerCase().includes(query),
  );
}

function indexOfCurrency(items: OfferCurrencyOption[], code: string): number {
  return items.findIndex((item) => item.code === code);
}

@Component({
  selector: 'app-currency-picker',
  standalone: true,
  imports: [FormsModule, TranslateModule, LucideAngularModule],
  templateUrl: './currency-picker.component.html',
  styleUrl: './currency-picker.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrencyPickerComponent {
  public readonly Check = Check;
  public readonly ChevronDown = ChevronDown;
  public readonly Search = Search;

  public items = input.required<OfferCurrencyOption[]>();
  public selected = input.required<string>();
  public suggested = input<string | null>(null);
  public disabled = input(false);
  public selectEmitter = output<string>();

  public readonly isOpen = signal(false);
  public readonly query = signal('');
  public readonly activeIndex = signal(0);

  public readonly current = computed<OfferCurrencyOption | undefined>(() => {
    const items = this.items();
    return items[Math.max(indexOfCurrency(items, this.selected()), 0)];
  });

  public readonly filtered = computed(() => filterCurrencies(this.items(), this.query()));

  public readonly activeOptionId = computed(() => {
    const item = this.filtered()[this.activeIndex()];
    return item ? `currency-option-${item.code}` : null;
  });

  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');
  private readonly optionElements = viewChild<ElementRef<HTMLElement>>('optionList');
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => this.searchField()?.nativeElement.focus());
  }

  @HostListener('document:pointerdown', ['$event'])
  public onDocumentPointerDown(event: PointerEvent): void {
    if (!this.isOpen()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  public toggle(): void {
    if (this.disabled()) return;
    this.isOpen() ? this.close() : this.open();
  }

  public open(): void {
    this.query.set('');
    this.activeIndex.set(Math.max(indexOfCurrency(this.filtered(), this.selected()), 0));
    this.isOpen.set(true);
  }

  public close(): void {
    this.isOpen.set(false);
  }

  public onQueryChange(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  public pick(code: string): void {
    this.close();
    if (code !== this.selected()) this.selectEmitter.emit(code);
  }

  public onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.isOpen()) {
          this.open();
          return;
        }
        this.move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      case 'Home':
      case 'End': {
        if (!this.isOpen()) return;
        event.preventDefault();
        this.moveTo(event.key === 'Home' ? 0 : this.filtered().length - 1);
        return;
      }
      case 'Enter': {
        if (!this.isOpen()) return;
        event.preventDefault();
        const item = this.filtered()[this.activeIndex()];
        if (item) this.pick(item.code);
        return;
      }
      case 'Escape': {
        if (!this.isOpen()) return;
        event.preventDefault();
        this.close();
        this.host.nativeElement.querySelector<HTMLElement>('.currency-trigger')?.focus();
        return;
      }
      case 'Tab': {
        this.close();
      }
    }
  }

  private move(step: number): void {
    const count = this.filtered().length;
    if (count === 0) return;
    this.moveTo((this.activeIndex() + step + count) % count);
  }

  private moveTo(index: number): void {
    this.activeIndex.set(index);
    const list = this.optionElements()?.nativeElement;
    list?.children[index]?.scrollIntoView({ block: 'nearest' });
  }
}
