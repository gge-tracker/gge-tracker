import { NgIf } from '@angular/common';
import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Filter, LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-filter',
  standalone: true,
  imports: [NgIf, LucideAngularModule, TranslatePipe],
  templateUrl: './filter.component.html',
  styleUrl: './filter.component.css',
})
export class FilterComponent {
  public countFilterActivated = input.required<number>();

  public readonly Funnel = Filter;
}
