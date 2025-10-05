import { trigger, transition, style, animate } from '@angular/animations';
import { Component } from '@angular/core';

import { GenericComponent } from '@ggetracker-components/generic/generic.component';

@Component({
  selector: 'app-skeleton',
  templateUrl: './skeleton.component.html',
  styleUrl: './skeleton.component.css',
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('600ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class SkeletonComponent extends GenericComponent {}
