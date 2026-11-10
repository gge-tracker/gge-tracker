import { Directive, ElementRef, OnChanges, OnDestroy, inject, input } from '@angular/core';
import { compact, grouped } from './chronicle-format';

const DURATION_MS = 1100;

@Directive({ selector: '[appCountUp]', standalone: true })
export class ChronicleCountUpDirective implements OnChanges, OnDestroy {
  public readonly appCountUp = input.required<number>();
  public readonly countStyle = input<'compact' | 'grouped'>('compact');
  public readonly countPrefix = input('');
  public readonly countDelay = input(250);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public ngOnChanges(): void {
    this.stop();
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.show(this.appCountUp());
      return;
    }
    this.show(0);
    this.timer = globalThis.setTimeout(() => this.animate(performance.now()), this.countDelay());
  }

  public ngOnDestroy(): void {
    this.stop();
  }

  private animate(startedAt: number): void {
    const progress = Math.min(1, (performance.now() - startedAt) / DURATION_MS);
    const eased = 1 - (1 - progress) ** 4;
    this.show(this.appCountUp() * eased);
    if (progress < 1) this.frame = requestAnimationFrame(() => this.animate(startedAt));
  }

  private show(value: number): void {
    const text = this.countStyle() === 'grouped' ? grouped(Math.round(value)) : compact(value);
    this.host.nativeElement.textContent = `${this.countPrefix()}${text}`;
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    globalThis.clearTimeout(this.timer);
  }
}
