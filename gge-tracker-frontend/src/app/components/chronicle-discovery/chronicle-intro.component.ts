import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CHRONICLE_PROMOTED_YEAR, ChronicleDiscoveryService } from '@ggetracker-services/chronicle-discovery.service';
import { TranslateModule } from '@ngx-translate/core';
import { CHRONICLE_ANCHOR_SELECTOR } from './chronicle-cta.component';

interface IntroLayout {
  hole: { top: number; left: number; width: number; height: number };
  placement: 'below' | 'above' | 'sheet';
  card: { top: number; left: number };
  arrowLeft: number;
}

const FIRST_LOOK_DELAY_MS = 900;
const ANCHOR_RETRY_MS = 400;
const ANCHOR_MAX_RETRIES = 25;
const SHEET_BELOW_WIDTH = 576;
const CARD_WIDTH = 372;
const CARD_HEIGHT_ESTIMATE = 410;
const CARD_GAP = 18;
const VIEWPORT_MARGIN = 12;
const ARROW_INSET = 28;
const HOLE_PADDING = 6;

@Component({
  selector: 'app-chronicle-intro',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  templateUrl: './chronicle-intro.component.html',
  styleUrl: './chronicle-intro.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChronicleIntroComponent implements OnInit, OnDestroy {
  public readonly playerId = input.required<string>();
  public readonly playerName = input('');
  public readonly mine = input(false);

  public readonly year = CHRONICLE_PROMOTED_YEAR;
  public readonly layout = signal<IntroLayout | null>(null);

  private readonly discovery = inject(ChronicleDiscoveryService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly primary = viewChild<ElementRef<HTMLElement>>('primary');
  private anchor: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;

  public ngOnInit(): void {
    if (!this.discovery.isIntroPending()) return;
    // Outside the page's stacking contexts, so the top bar and sidebar are dimmed too
    document.body.append(this.host.nativeElement);
    this.timer = setTimeout(() => this.openWhenAnchorIsVisible(ANCHOR_MAX_RETRIES), FIRST_LOOK_DELAY_MS);
  }

  public ngOnDestroy(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.stopFollowingViewport();
    this.host.nativeElement.remove();
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    if (this.layout()) this.close();
  }

  public close(): void {
    this.layout.set(null);
    this.stopFollowingViewport();
    this.anchor?.focus({ preventScroll: true });
  }

  private readonly onViewportChange = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.measure());
  };

  private openWhenAnchorIsVisible(retries: number): void {
    this.anchor = this.visibleAnchor();
    if (this.anchor) {
      this.open();
    } else if (retries > 0) {
      this.timer = setTimeout(() => this.openWhenAnchorIsVisible(retries - 1), ANCHOR_RETRY_MS);
    }
  }

  private visibleAnchor(): HTMLElement | null {
    const anchors = document.querySelectorAll<HTMLElement>(CHRONICLE_ANCHOR_SELECTOR);
    // eslint-disable-next-line unicorn/prefer-spread -- tsconfig has no dom.iterabl -> NodeList cannot be spread
    return Array.from(anchors).find((element) => element.getClientRects().length > 0) ?? null;
  }

  private open(): void {
    this.discovery.markIntroShown();
    this.anchor!.scrollIntoView({ block: 'nearest' });
    this.measure();
    globalThis.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
    globalThis.addEventListener('resize', this.onViewportChange, { passive: true });
    // The first layout used an estimate: the rendered card gives the real height
    this.frame = requestAnimationFrame(() => {
      this.measure();
      this.primary()?.nativeElement.focus({ preventScroll: true });
    });
  }

  private measure(): void {
    if (!this.anchor) return;
    const anchor = this.anchor.getBoundingClientRect();
    const cardHeight = this.card()?.nativeElement.offsetHeight ?? CARD_HEIGHT_ESTIMATE;
    const placement = this.placementFor(anchor, cardHeight);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, anchor.left + anchor.width / 2 - CARD_WIDTH / 2),
      globalThis.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN,
    );
    this.layout.set({
      placement,
      hole: {
        top: anchor.top - HOLE_PADDING,
        left: anchor.left - HOLE_PADDING,
        width: anchor.width + HOLE_PADDING * 2,
        height: anchor.height + HOLE_PADDING * 2,
      },
      card: { left, top: placement === 'above' ? anchor.top - CARD_GAP - cardHeight : anchor.bottom + CARD_GAP },
      arrowLeft: Math.min(Math.max(ARROW_INSET, anchor.left + anchor.width / 2 - left), CARD_WIDTH - ARROW_INSET),
    });
  }

  private placementFor(anchor: DOMRect, cardHeight: number): IntroLayout['placement'] {
    if (globalThis.innerWidth < SHEET_BELOW_WIDTH) return 'sheet';
    if (anchor.bottom + CARD_GAP + cardHeight <= globalThis.innerHeight - VIEWPORT_MARGIN) return 'below';
    return anchor.top - CARD_GAP - cardHeight >= VIEWPORT_MARGIN ? 'above' : 'sheet';
  }

  private stopFollowingViewport(): void {
    globalThis.removeEventListener('scroll', this.onViewportChange, { capture: true });
    globalThis.removeEventListener('resize', this.onViewportChange);
  }
}
