import { DOCUMENT } from '@angular/common';
import { Injectable, Inject } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class WindowService {
  constructor(@Inject(DOCUMENT) private _doc: Document) {}

  public getWindow(): (Window & typeof globalThis) | null {
    return this._doc.defaultView;
  }

  public getLocation(): Location {
    return this._doc.location;
  }

  public createElement(tag: string): HTMLElement {
    return this._doc.createElement(tag);
  }
}
