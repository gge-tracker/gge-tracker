import { NgClass, NgFor, NgIf } from '@angular/common';
import { AfterViewInit, Component, ElementRef, inject, input, ViewChild } from '@angular/core';
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
export class ServerBadgeComponent extends GenericComponent implements AfterViewInit {
  public allowedServers = input<string[]>();
  public infoDisplayed = input<boolean>(true);
  public version = '';
  public shortVersion = '';
  public dateVersion = '';
  public serversInDeployList = [];
  public serverService = inject(ServerService);
  public filteredServerInput: string = '';

  @ViewChild('searchServerInput') private searchServerInput!: ElementRef<HTMLInputElement>;
  @ViewChild('dropdownSearchButton', { static: true }) private dropdownSearchButton!: ElementRef<HTMLButtonElement>;

  constructor() {
    super();
    this.constructVersion(package_.version);
  }

  public ngAfterViewInit(): void {
    this.dropdownSearchButton.nativeElement.addEventListener('shown.bs.dropdown', () => {
      setTimeout(() => {
        this.searchServerInput?.nativeElement.focus();
      }, 100);
    });
  }

  public get currentServer(): string {
    return this.serverService.currentServer;
  }

  public set currentServer(value: string) {
    this.serverService.currentServer = value;
  }

  public get servers(): string[] {
    const servers = this.allowedServers() ?? this.serverService.servers;
    return servers.filter(
      (server) =>
        this.filteredServerInput.length === 0 || server.toLowerCase().includes(this.filteredServerInput.toLowerCase()),
    );
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
