import { Component, inject } from '@angular/core';

import { TroopsAnimationComponent } from './troops-animation/troops-animation.component';
import { ApiRestService } from '@ggetracker-services/api-rest.service';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [TroopsAnimationComponent],
  templateUrl: './maintenance.component.html',
  styleUrl: './maintenance.component.css',
})
export class MaintenanceComponent {
  private apiRest = inject(ApiRestService);

  constructor() {
    this.waitLastUpdate();
  }

  private waitLastUpdate(): void {
    void this.apiRest.getLastUpdates(false).then((data) => {
      if (data.success) {
        globalThis.location.href = '/';
      } else {
        setTimeout(() => {
          this.waitLastUpdate();
        }, 10_000);
      }
    });
  }
}
