import { Component, Input } from '@angular/core';

import {
  ArrowDown01,
  ArrowUpRight,
  ChevronDown,
  Clock,
  CodeXml,
  Globe,
  Info,
  LucideAngularModule,
  Menu,
  Search,
  TrendingDown,
  TriangleAlert,
  Trophy,
  X,
  Zap,
} from 'lucide-angular';

export const myIcons = {
  ChevronDown,
  Menu,
  Search,
  Info,
  Globe,
  CodeXml,
  ArrowDown01,
  Clock,
  TrendingDown,
  Trophy,
  Zap,
  TriangleAlert,
  ArrowUpRight,
  X,
};

/**
 * Icon component to display lucide icons
 * Usage: <app-icon name="Search" size="32"></app-icon>
 */
@Component({
  selector: 'app-icon',
  imports: [LucideAngularModule],
  template: ` <lucide-icon [name]="name" [size]="size" class="lucide d-flex"> </lucide-icon> `,
  standalone: true,
})
export class IconComponent {
  @Input() public name: keyof typeof myIcons = 'Info';
  @Input() public size: number = 24;
}
