import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { ToastService } from '@ggetracker-services/toast.service';

export type ShareSubject = 'player' | 'alliance';

type ShareMethod = 'copy' | 'native' | 'image';

@Component({
  selector: 'app-share-link',
  exportAs: 'shareLink',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './share-link.component.html',
  styleUrl: './share-link.component.css',
})
export class ShareLinkComponent {
  public readonly subject = input.required<ShareSubject>();
  public readonly subjectId = input.required<number>();
  public readonly name = input('');

  public readonly isOpen = signal(false);
  public readonly isImageLoaded = signal(false);
  public readonly canShareNatively = typeof globalThis.navigator?.share === 'function';

  public get pageUrl(): string {
    const origin = globalThis.location?.origin ?? 'https://gge-tracker.com';
    return `${origin}/${this.subject()}/${this.subjectId()}`;
  }

  public get imageUrl(): string {
    return `${ApiRestService.apiUrl}assets/og/${this.subject()}/${this.subjectId()}.png`;
  }

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly toastService = inject(ToastService);
  private readonly translateService = inject(TranslateService);

  public open(): void {
    this.isImageLoaded.set(false);
    this.isOpen.set(true);
    this.dialog().nativeElement.showModal();
  }

  public close(): void {
    this.dialog().nativeElement.close();
  }

  public onDialogClosed(): void {
    this.isOpen.set(false);
  }

  public onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  public async copyLink(): Promise<void> {
    try {
      await globalThis.navigator.clipboard.writeText(this.pageUrl);
      this.toastService.info(this.translateService.instant('Lien copié'));
      this.track('copy');
    } catch {
      this.selectLinkField();
    }
  }

  public async shareNatively(): Promise<void> {
    try {
      await globalThis.navigator.share({ title: this.name() || undefined, url: this.pageUrl });
      this.track('native');
    } catch {}
  }

  public onImageOpened(): void {
    this.track('image');
  }

  public selectLinkField(event?: Event): void {
    const field = (event?.target as HTMLInputElement | undefined) ?? this.linkField();
    field?.select();
  }

  private linkField(): HTMLInputElement | null {
    return this.dialog().nativeElement.querySelector('input');
  }

  private track(method: ShareMethod): void {
    const dataLayer = (globalThis as { dataLayer?: unknown[] }).dataLayer;
    dataLayer?.push({ event: 'share', method, content_type: this.subject(), item_id: String(this.subjectId()) });
  }
}
