import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, icons } from 'lucide-angular';

export const myIcons: Pick<typeof icons, 'ChevronDown' | 'Menu' | 'Search' | 'Info' | 'Globe'> = {
  ChevronDown: icons.ChevronDown,
  Menu: icons.Menu,
  Search: icons.Search,
  Info: icons.Info,
  Globe: icons.Globe,
};

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: ` <lucide-icon [name]="name" [size]="size" class="lucide d-flex"> </lucide-icon> `,
})
export class IconComponent {
  @Input() public name: keyof typeof myIcons = 'Info';
  @Input() public size: number = 24;
}
