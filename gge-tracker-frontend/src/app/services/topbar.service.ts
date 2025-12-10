import { Injectable, Injector } from '@angular/core';
import { ComponentPortal, DomPortalOutlet, ComponentType } from '@angular/cdk/portal';

interface Pending {
  component: ComponentType<any>;
  injector?: Injector;
}

@Injectable({ providedIn: 'root' })
export class TopBarService {
  private outlet?: DomPortalOutlet;
  private pending: Pending[] = [];

  public registerOutlet(outlet: DomPortalOutlet): void {
    this.outlet = outlet;
    while (this.pending.length > 0) {
      const p = this.pending.shift()!;
      this._doAttach(p.component, p.injector);
    }
  }

  public attach(component: ComponentType<any>, injector?: Injector): void {
    if (!this.outlet) {
      this.pending.push({ component, injector });
      return;
    }
    this._doAttach(component, injector);
  }

  public clear(): void {
    try {
      this.outlet?.detach();
    } catch {}
    this.pending = [];
  }

  private _doAttach(component: ComponentType<any>, injector?: Injector): void {
    if (!this.outlet) return;
    const portal = new ComponentPortal(component, null, injector);
    this.outlet.attach(portal);
  }
}
