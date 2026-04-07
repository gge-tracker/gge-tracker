import { trigger, transition, style, animate } from '@angular/animations';
import { Component, inject } from '@angular/core';

import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SidebarService } from '@ggetracker-services/sidebar.service';
import { NgClass, DatePipe } from '@angular/common';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopBarComponent } from '../top-bar/top-bar.component';
import { LoadingComponent } from '../loading/loading.component';
import { RouterOutlet } from '@angular/router';
import { FooterComponent } from '../footer/footer.component';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-skeleton',
  templateUrl: './skeleton.component.html',
  styleUrls: ['./skeleton.component.css'],
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('600ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
  imports: [
    NgClass,
    SidebarComponent,
    TopBarComponent,
    LoadingComponent,
    RouterOutlet,
    FooterComponent,
    DatePipe,
    TranslatePipe,
  ],
})
export class SkeletonComponent extends GenericComponent {
  public sidebarService = inject(SidebarService);
}
