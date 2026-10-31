import { ChangeDetectionStrategy, Component, inject, input, OnChanges, output } from '@angular/core';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { UtilitiesService } from '@ggetracker-services/utilities.service';
import { TranslateModule } from '@ngx-translate/core';

export interface GlobalRangeField {
  icon: string;
  label: string;
  title: string;
  min: { key: string; placeholder: string };
  max: { key: string; placeholder: string };
  freeText?: boolean;
}

@Component({
  selector: 'app-global-ranking-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, ModalFormGroupComponent],
  providers: [FormatNumberPipe],
  templateUrl: './global-ranking-filters.component.html',
  styleUrl: './global-ranking-filters.component.css',
})
export class GlobalRankingFiltersComponent implements OnChanges {
  public readonly modalId = input.required<string>();
  public readonly fields = input.required<GlobalRangeField[]>();
  public readonly applied = input<Record<string, string>>({});
  public readonly apply = output<Record<string, string>>();
  public values: Record<string, string> = {};
  public display: Partial<Record<string, string>> = {};
  private readonly utilitiesService = inject(UtilitiesService);
  private readonly formatNumberPipe = inject(FormatNumberPipe);

  public ngOnChanges(): void {
    this.values = { ...this.applied() };
    this.display = {};
    for (const field of this.fields()) {
      for (const { key } of [field.min, field.max]) this.display[key] = this.formatted(key, field);
    }
  }

  public hasValues(): boolean {
    return Object.values(this.values).some((value) => value !== '');
  }

  public onFocus(key: string): void {
    this.display[key] = this.values[key] ?? '';
  }

  public onInput(key: string, field: GlobalRangeField, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.display[key] = raw;
    if (field.freeText) {
      this.values[key] = raw.replaceAll(/\s/g, '');
      return;
    }
    const parsed = raw.trim() === '' ? Number.NaN : this.utilitiesService.parseValue(raw);
    this.values[key] = Number.isFinite(parsed) && parsed > 0 ? String(Math.trunc(parsed)) : '';
  }

  public onBlur(key: string, field: GlobalRangeField): void {
    this.display[key] = this.formatted(key, field);
  }

  public reset(): void {
    this.values = {};
    this.display = {};
  }

  public submit(): void {
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.values)) {
      if (value !== '') filters[key] = value;
    }
    this.apply.emit(filters);
  }

  private formatted(key: string, field: GlobalRangeField): string {
    const value = this.values[key];
    if (!value) return '';
    return field.freeText ? value : this.utilitiesService.formatNumber(this.formatNumberPipe, Number(value));
  }
}
