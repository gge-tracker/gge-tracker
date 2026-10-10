import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { loadTavernLibraries } from './tavern-libraries';
import { Framing, TavernScene, TavernStage } from './tavern-stage';

@Component({
  selector: 'app-tavern-scene',
  standalone: true,
  templateUrl: './tavern-scene.component.html',
  styleUrl: './tavern-scene.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TavernSceneComponent implements OnDestroy {
  public readonly live = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly teardown: (() => void)[] = [];
  private stage: TavernStage | null = null;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      if (this.motionAllowed()) void this.start();
    });
  }

  public ngOnDestroy(): void {
    this.destroyed = true;
    for (const release of this.teardown) release();
    this.stage?.destroy();
  }

  private async start(): Promise<void> {
    try {
      const [scene] = await Promise.all([
        fetch('/assets/tavern/scene.json').then((response) => response.json() as Promise<TavernScene>),
        loadTavernLibraries(),
      ]);
      if (this.destroyed) return;
      const stage = await TavernStage.create(this.canvas().nativeElement, scene);
      if (this.destroyed) {
        stage.destroy();
        return;
      }
      this.stage = stage;
      this.follow(stage);
      this.live.set(true);
    } catch {
      this.live.set(false);
    }
  }

  private motionAllowed(): boolean {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return !matchMedia('(prefers-reduced-motion: reduce)').matches && connection?.saveData !== true;
  }

  private framing(): Framing {
    const style = getComputedStyle(this.host.nativeElement);
    const read = (name: string, fallback: number): number =>
      Number.parseFloat(style.getPropertyValue(name)) || fallback;
    return {
      focusX: read('--tavern-focus-x', 0.5),
      focusY: read('--tavern-focus-y', 0.5),
      zoom: read('--tavern-zoom', 1),
    };
  }

  private follow(stage: TavernStage): void {
    const canvas = this.canvas().nativeElement;
    const host = this.host.nativeElement;
    let onScreen = true;
    const refresh = (): void => (onScreen && document.visibilityState === 'visible' ? stage.play() : stage.pause());

    stage.resize(canvas.clientWidth, canvas.clientHeight, this.framing());
    const resizing = new ResizeObserver(() => stage.resize(canvas.clientWidth, canvas.clientHeight, this.framing()));
    resizing.observe(canvas);
    const intersecting = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      refresh();
    });
    intersecting.observe(host);
    document.addEventListener('visibilitychange', refresh);
    this.teardown.push(
      () => resizing.disconnect(),
      () => intersecting.disconnect(),
      () => document.removeEventListener('visibilitychange', refresh),
    );

    if (matchMedia('(pointer: fine)').matches) {
      const pointing = (event: PointerEvent): void => stage.point(event.clientX, event.clientY);
      globalThis.addEventListener('pointermove', pointing, { passive: true });
      this.teardown.push(() => globalThis.removeEventListener('pointermove', pointing));
    }
    refresh();
  }
}
