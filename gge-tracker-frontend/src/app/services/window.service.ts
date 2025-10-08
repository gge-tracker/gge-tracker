import { DOCUMENT } from '@angular/common';
import { Injectable, Inject } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class WindowService {
  constructor(@Inject(DOCUMENT) private _document: Document) {}

  public getWindow(): (Window & typeof globalThis) | null {
    return this._document.defaultView;
  }

  public getLocation(): Location {
    return this._document.location;
  }

  public createElement(tag: string): HTMLElement {
    return this._document.createElement(tag);
  }
}
