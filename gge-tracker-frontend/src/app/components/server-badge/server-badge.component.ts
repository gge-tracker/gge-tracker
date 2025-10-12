import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import package_ from '../../../../package.json';
import { SortByOrderPipe } from '@ggetracker-pipes/sort-by-order.pipe';
import { ServerService } from '@ggetracker-services/server.service';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';

@Component({
  selector: 'app-server-badge',
  standalone: true,
  imports: [TranslateModule, NgFor, FormsModule, SortByOrderPipe, NgIf, NgClass],
  templateUrl: './server-badge.component.html',
  styleUrl: './server-badge.component.css',
})
export class ServerBadgeComponent extends GenericComponent {
  public allowedServers = input<string[]>();
  public infoDisplayed = input<boolean>(true);
  public version = '';
  public shortVersion = '';
  public dateVersion = '';
  public serversInDeployList = ['E4K-BR1', 'E4K-HANT1'];
  public serverService = inject(ServerService);

  constructor() {
    super();
    this.constructVersion(package_.version);
  }

  public get currentServer(): string {
    return this.serverService.currentServer;
  }

  public set currentServer(value: string) {
    this.serverService.currentServer = value;
  }

  public get servers(): string[] {
    const allowed = this.allowedServers();
    if (allowed) return allowed;
    return this.serverService.servers;
  }

  public get choosedServer(): string {
    return this.serverService.choosedServer;
  }

  public changeServer(): void {
    this.serverService.changeServer(this.currentServer);
  }

  public getMappedServersToGgeServerName(server: string): string {
    return this.serverService.mappedServersToGgeServerName[server];
  }

  public removeCode(server: string): string {
    return server.slice(0, -1);
  }

  public serversInDeploy(): string[] {
    return this.serversInDeployList;
  }

  private constructVersion(version: string): void {
    const split = version.split('-')[0];
    this.version = split.replaceAll('.', '-');
    this.shortVersion = 'v' + split;
  }
}
