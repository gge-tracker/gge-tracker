import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Filter, LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-filter',
  imports: [LucideAngularModule, TranslatePipe],
  templateUrl: './filter.component.html',
  styleUrl: './filter.component.css',
  standalone: true,
})
export class FilterComponent {
  public countFilterActivated = input.required<number>();

  public readonly Funnel = Filter;
}
