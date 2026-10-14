import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CastleIsoMode, CastleIsoRenderer, CATEGORY_COLORS } from './castle-iso-renderer';
import { CastleIsoScene } from './castle-iso-scene';

export interface CastleIsoTooltip {
  title: string;
  subtitle: string;
}

interface PointerTrack {
  x: number;
  y: number;
}

const DRAG_THRESHOLD = 5;
const WHEEL_ZOOM_STEP = 1.0015;
const KEYBOARD_PAN_STEP = 60;
const PINNED_CARD_ROOM = 140;
const LEGEND = Object.entries(CATEGORY_COLORS).map(([key, color]) => ({ key, color }));

@Component({
  selector: 'app-castle-iso-view',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './castle-iso-view.component.html',
  styleUrl: './castle-iso-view.component.css',
})
export class CastleIsoViewComponent<T extends object> implements AfterViewInit, OnChanges, OnDestroy {
  public readonly legend = LEGEND;

  public loading = true;
  public failed = false;
  public progress = 0;
  public labels = false;
  public animated = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  public isFullscreen = false;
  public tooltip: (CastleIsoTooltip & { x: number; y: number; pinned: boolean; below?: boolean }) | null = null;
  public menuOpen = false;

  @Output() public readonly selectBuilding = new EventEmitter<T>();

  @ViewChild('stage', { static: true }) public stageRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvas', { static: true }) public canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() public scene: CastleIsoScene<T> | null = null;
  @Input() public highlighted: T[] | null = null;
  @Input() public fileName = 'castle';
  @Input() public mode: CastleIsoMode = 'render';

  private pinned: T | null = null;
  private renderer: CastleIsoRenderer<T> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly pointers = new Map<number, PointerTrack>();
  private dragDistance = 0;
  private pinchDistance = 0;
  private hoverFrame = 0;
  private destroyed = false;
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() public categoryLabel: (category: string) => string = (category) => category;
  @Input() public describe: (reference: T) => CastleIsoTooltip = () => ({ title: '', subtitle: '' });

  public async ngAfterViewInit(): Promise<void> {
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    try {
      this.renderer = await CastleIsoRenderer.create<T>(
        this.canvasRef.nativeElement,
        (reference) => this.describe(reference).title,
      );
    } catch {
      this.failed = true;
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }
    if (this.destroyed) {
      this.renderer.destroy();
      return;
    }
    this.renderer.setAnimated(this.animated);
    this.zone.runOutsideAngular(() => this.bindEvents());
    this.observeSize();
    await this.loadScene();
  }

  public async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!this.renderer) return;
    if (changes['scene']) await this.loadScene();
    if (changes['highlighted']) this.renderer.setHighlighted(this.highlighted);
    if (changes['mode']) this.renderer.setMode(this.mode);
  }

  public ngOnDestroy(): void {
    this.destroyed = true;
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.hoverFrame);
    this.renderer?.destroy();
  }

  public zoomIn(): void {
    this.renderer?.zoomBy(1.25);
  }

  public zoomOut(): void {
    this.renderer?.zoomBy(0.8);
  }

  public fit(): void {
    this.renderer?.fitToView();
  }

  public toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  public openPinned(): void {
    if (this.pinned) this.selectBuilding.emit(this.pinned);
    this.unpin();
  }

  public toggleLabels(): void {
    this.labels = !this.labels;
    this.renderer?.setLabels(this.labels);
  }

  public toggleAnimations(): void {
    this.animated = !this.animated;
    this.renderer?.setAnimated(this.animated);
  }

  public toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.stageRef.nativeElement.requestFullscreen?.();
    }
  }

  public downloadSnapshot(): void {
    if (!this.renderer) return;
    const link = document.createElement('a');
    link.href = this.renderer.snapshot();
    link.download = `${this.fileName}.png`;
    link.click();
  }

  public focusOn(reference: T): void {
    this.renderer?.focus(reference);
  }

  public onKeydown(event: KeyboardEvent): void {
    const pans: Record<string, [number, number]> = {
      ArrowUp: [0, KEYBOARD_PAN_STEP],
      ArrowDown: [0, -KEYBOARD_PAN_STEP],
      ArrowLeft: [KEYBOARD_PAN_STEP, 0],
      ArrowRight: [-KEYBOARD_PAN_STEP, 0],
    };
    const pan = pans[event.key];
    if (pan) this.renderer?.panBy(...pan);
    else
      switch (event.key) {
        case '+':
        case '=': {
          this.zoomIn();
          break;
        }
        case '-': {
          this.zoomOut();
          break;
        }
        case '0': {
          this.fit();
          break;
        }
        default: {
          return;
        }
      }
    event.preventDefault();
  }

  private async loadScene(): Promise<void> {
    if (!this.renderer || !this.scene) return;
    this.loading = true;
    this.progress = 0;
    this.cdr.markForCheck();
    await this.renderer.setScene(this.scene, (loaded, total) => {
      this.progress = total === 0 ? 100 : Math.round((loaded / total) * 100);
      this.cdr.markForCheck();
    });
    this.renderer.setMode(this.mode);
    this.renderer.setLabels(this.labels);
    this.renderer.setHighlighted(this.highlighted);
    this.loading = false;
    this.cdr.markForCheck();
  }

  private readonly onFullscreenChange = (): void => {
    this.isFullscreen = document.fullscreenElement === this.stageRef.nativeElement;
    this.cdr.markForCheck();
  };

  private observeSize(): void {
    const stage = this.stageRef.nativeElement;
    const apply = (): void => {
      this.renderer?.resize(stage.clientWidth, stage.clientHeight, Math.min(2, globalThis.devicePixelRatio || 1));
    };
    apply();
    this.renderer?.fitToView();
    this.resizeObserver = new ResizeObserver(apply);
    this.resizeObserver.observe(stage);
  }

  private bindEvents(): void {
    const canvas = this.canvasRef.nativeElement;
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    canvas.addEventListener('pointercancel', (event) => this.pointers.delete(event.pointerId));
    canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') this.showTooltip(null, 0, 0);
    });
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
  }

  private localPoint(event: PointerEvent | WheelEvent): PointerTrack {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    this.canvasRef.nativeElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, this.localPoint(event));
    this.dragDistance = 0;
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance();
  }

  private onPointerMove(event: PointerEvent): void {
    const point = this.localPoint(event);
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      this.scheduleHover(point);
      return;
    }
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance();
      const center = this.pinchCenter();
      if (this.pinchDistance > 0) this.renderer?.zoomBy(distance / this.pinchDistance, center.x, center.y);
      this.pinchDistance = distance;
      this.dragDistance = Infinity;
      return;
    }
    const deltaX = point.x - previous.x;
    const deltaY = point.y - previous.y;
    this.dragDistance += Math.hypot(deltaX, deltaY);
    if (this.dragDistance > DRAG_THRESHOLD) {
      this.renderer?.panBy(deltaX, deltaY);
      this.unpin();
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const point = this.localPoint(event);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size > 0 || this.dragDistance > DRAG_THRESHOLD) return;
    const reference = this.renderer?.pick(point.x, point.y) ?? null;
    if (this.menuOpen) this.zone.run(() => (this.menuOpen = false));
    if (event.pointerType === 'mouse') {
      if (reference) this.zone.run(() => this.selectBuilding.emit(reference));
      return;
    }
    this.onTap(reference, point);
  }

  private onTap(reference: T | null, point: PointerTrack): void {
    if (reference && reference === this.pinned) {
      // Touch has no hover:
      // - the first tap shows the card
      // a second tap on the same building opens it
      this.zone.run(() => this.openPinned());
      return;
    }
    if (!reference) {
      this.unpin();
      return;
    }
    this.pinned = reference;
    this.renderer?.hover(point.x, point.y);
    this.zone.run(() => {
      this.tooltip = {
        ...this.describe(reference),
        x: point.x,
        y: point.y,
        pinned: true,
        below: point.y < PINNED_CARD_ROOM,
      };
      this.cdr.markForCheck();
    });
  }

  private unpin(): void {
    this.pinned = null;
    this.showTooltip(null, 0, 0);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = this.localPoint(event);
    this.renderer?.zoomBy(WHEEL_ZOOM_STEP ** -event.deltaY, point.x, point.y);
    this.showTooltip(null, 0, 0);
  }

  private scheduleHover(point: PointerTrack): void {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = requestAnimationFrame(() => {
      const reference = this.renderer?.hover(point.x, point.y) ?? null;
      this.canvasRef.nativeElement.style.cursor = reference ? 'pointer' : 'grab';
      this.showTooltip(reference, point.x, point.y);
    });
  }

  private showTooltip(reference: T | null, x: number, y: number): void {
    if (!reference) this.renderer?.hover(null, null);
    const next = reference ? { ...this.describe(reference), x, y, pinned: false } : null;
    if (next === null && this.tooltip === null) return;
    this.zone.run(() => {
      this.tooltip = next;
      this.cdr.markForCheck();
    });
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pinchCenter(): PointerTrack {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
