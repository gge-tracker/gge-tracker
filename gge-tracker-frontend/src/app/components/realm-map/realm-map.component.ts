import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  output,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import {
  RealmMapExtent,
  RealmMapOrigin,
  RealmMapPoint,
  REALM_MAP_HIGHLIGHT_COLOR,
  REALM_WORLD_EXTENT,
} from './realm-map.models';

interface PlacedMarker {
  marker: Leaflet.CircleMarker;
  point: RealmMapPoint;
}

type MarkerConstructor = new (
  latlng: Leaflet.LatLngExpression,
  options: Leaflet.CircleMarkerOptions,
) => Leaflet.CircleMarker;

const FIT_PADDING = 18;
const LAYER_CLICK_GUARD_MS = 80;
const MIN_TICK_SPACING_PX = 38;

@Component({
  selector: 'app-realm-map',
  standalone: true,
  templateUrl: './realm-map.component.html',
  styleUrl: './realm-map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RealmMapComponent implements AfterViewInit, OnDestroy {
  public readonly points = input<RealmMapPoint[]>([]);
  public readonly extent = input<RealmMapExtent>(REALM_WORLD_EXTENT);
  public readonly gridStep = input(100);
  public readonly field = input('#2fa3c4');
  public readonly origin = input<RealmMapOrigin | null>(null);
  public readonly rings = input<number[]>([]);
  public readonly selectedId = input<string | null>(null);
  public readonly picking = input(false);
  public readonly pointSelected = output<string | null>();
  public readonly picked = output<{ x: number; y: number }>();
  public readonly cursor = signal<string | null>(null);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('mapHost');
  private readonly zone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly ready = signal(false);
  private readonly placed = new Map<string, PlacedMarker>();
  private readonly idByMarker = new Map<Leaflet.Layer, string>();
  private L!: typeof Leaflet;
  private map: Leaflet.Map | null = null;
  private DiamondMarker!: MarkerConstructor;
  private fieldLayer!: Leaflet.LayerGroup;
  private pointsLayer!: Leaflet.FeatureGroup;
  private originLayer!: Leaflet.LayerGroup;
  private tooltip!: Leaflet.Tooltip;
  private selectionMarker: Leaflet.Marker | null = null;
  private drawnExtentKey = '';
  private fitZoom = 0;
  private markerScale = 1;
  private lastLayerClickAt = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const extent = this.extent();
      const field = this.field();
      const step = this.gridStep();
      if (this.ready()) untracked(() => this.drawField(extent, field, step));
    });
    effect(() => {
      const points = this.points();
      if (this.ready()) untracked(() => this.syncPoints(points));
    });
    effect(() => {
      const origin = this.origin();
      const rings = this.rings();
      if (this.ready()) untracked(() => this.drawOrigin(origin, rings));
    });
    effect(() => {
      const selectedId = this.selectedId();
      this.points();
      if (this.ready()) untracked(() => this.drawSelection(selectedId));
    });
    effect(() => {
      const picking = this.picking();
      if (this.ready()) this.host().nativeElement.classList.toggle('is-picking', picking);
    });
  }

  public async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser) return;
    const leafletModule = await import('leaflet');
    this.L = leafletModule.default ?? leafletModule;
    this.zone.runOutsideAngular(() => this.createMap());
    this.ready.set(true);
  }

  public ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  public fit(): void {
    if (!this.map) return;
    const size = this.map.getSize();
    if (size.x === 0 || size.y === 0) return;
    this.map.fitBounds(this.boundsOf(this.extent()), { padding: [FIT_PADDING, FIT_PADDING], animate: false });
    this.fitZoom = this.map.getZoom();
    this.map.setMinZoom(this.fitZoom - 0.75);
    this.applyScale();
  }

  public focus(x: number, y: number): void {
    if (!this.map) return;
    const zoom = Math.max(this.map.getZoom(), this.fitZoom + 1.5);
    const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      this.map.setView([-y, x], zoom);
    } else {
      this.map.flyTo([-y, x], zoom, { duration: 0.6 });
    }
  }

  private createMap(): void {
    const L = this.L;
    this.map = L.map(this.host().nativeElement, {
      attributionControl: false,
      crs: L.CRS.Simple,
      renderer: L.canvas({ padding: 0.5, tolerance: 4 }),
      preferCanvas: true,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      minZoom: -3,
      maxZoom: 5,
    });
    this.map.setView([0, 0], 0);
    this.DiamondMarker = this.createDiamondMarkerClass();
    this.fieldLayer = L.layerGroup().addTo(this.map);
    this.pointsLayer = L.featureGroup().addTo(this.map);
    this.originLayer = L.layerGroup().addTo(this.map);
    // eslint-disable-next-line unicorn/no-keyword-prefix -- Leaflet option name
    this.tooltip = L.tooltip({ direction: 'top', offset: [0, -6], className: 'rmap-tooltip', opacity: 1 });
    this.pointsLayer.on('mouseover', (event: Leaflet.LeafletEvent) => this.showTooltip(event.propagatedFrom));
    this.pointsLayer.on('mouseout', () => this.map?.closeTooltip(this.tooltip));
    this.pointsLayer.on('click', (event: Leaflet.LeafletEvent) => this.onPointClick(event.propagatedFrom));
    this.map.on('click', (event: Leaflet.LeafletMouseEvent) => this.onMapClick(event.latlng));
    this.map.on('mousemove', (event: Leaflet.LeafletMouseEvent) => this.updateCursor(event.latlng));
    this.map.on('mouseout', () => this.updateCursor(null));
    this.map.on('zoomend', () => this.applyScale());
    this.observeSize();
  }

  // Leaflet has no diamond marker: draw the path on the canvas renderer, hit testing stays circular
  private createDiamondMarkerClass(): MarkerConstructor {
    return this.L.CircleMarker.extend({
      _updatePath(this: Leaflet.CircleMarker & Record<string, any>) {
        const renderer = this['_renderer'];
        if (!renderer._drawing || this['_empty']()) return;
        const { x, y } = this['_point'];
        const radius = Math.max(this['_radius'], 1);
        const context: CanvasRenderingContext2D = renderer._ctx;
        context.beginPath();
        context.moveTo(x, y - radius);
        context.lineTo(x + radius, y);
        context.lineTo(x, y + radius);
        context.lineTo(x - radius, y);
        context.closePath();
        renderer._fillStroke(context, this);
      },
    }) as unknown as MarkerConstructor;
  }

  private observeSize(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.map) return;
      const container = this.map.getContainer();
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      const wasShowingAll = this.map.getZoom() <= this.fitZoom + 0.25;
      this.map.invalidateSize();
      if (wasShowingAll || this.fitZoom === 0) {
        this.fit();
      } else {
        this.applyScale();
      }
    });
    this.resizeObserver.observe(this.host().nativeElement);
  }

  private drawField(extent: RealmMapExtent, field: string, step: number): void {
    const key = `${extent.minX}:${extent.maxX}:${extent.minY}:${extent.maxY}:${field}:${step}`;
    if (key === this.drawnExtentKey || !this.map) return;
    this.drawnExtentKey = key;
    const L = this.L;
    this.fieldLayer.clearLayers();
    const bounds = this.boundsOf(extent);
    L.rectangle(bounds, {
      color: 'rgba(0, 0, 0, 0.55)',
      weight: 1.5,
      fillColor: field,
      fillOpacity: 0.32,
      interactive: false,
    }).addTo(this.fieldLayer);
    this.drawGrid(extent, step);
    const spanX = extent.maxX - extent.minX;
    const spanY = extent.maxY - extent.minY;
    this.map.setMaxBounds(bounds.pad(Math.max(0.25, 120 / Math.max(spanX, spanY, 1))));
    this.fit();
  }

  private drawGrid(extent: RealmMapExtent, step: number): void {
    const L = this.L;
    const lines: Leaflet.LatLngExpression[][] = [];
    const firstX = Math.ceil((extent.minX + 1) / step) * step;
    const firstY = Math.ceil((extent.minY + 1) / step) * step;
    for (let x = firstX; x < extent.maxX; x += step) {
      lines.push([
        [-extent.minY, x],
        [-extent.maxY, x],
      ]);
      this.addTick(String(x), [-extent.minY, x], 'rmap-tick rmap-tick-x');
    }
    for (let y = firstY; y < extent.maxY; y += step) {
      lines.push([
        [-y, extent.minX],
        [-y, extent.maxX],
      ]);
      this.addTick(String(y), [-y, extent.minX], 'rmap-tick rmap-tick-y');
    }
    L.polyline(lines, { color: '#ffffff', opacity: 0.08, weight: 1, interactive: false }).addTo(this.fieldLayer);
  }

  private addTick(label: string, latlng: Leaflet.LatLngExpression, classes: string): void {
    // eslint-disable-next-line unicorn/no-keyword-prefix -- Leaflet option name
    const icon = this.L.divIcon({ className: classes, html: `<span>${label}</span>`, iconSize: [0, 0] });
    this.L.marker(latlng, { icon, interactive: false, keyboard: false }).addTo(this.fieldLayer);
  }

  private syncPoints(points: RealmMapPoint[]): void {
    const seen = new Set<string>();
    const created: RealmMapPoint[] = [];
    const raised: Leaflet.CircleMarker[] = [];
    for (const point of points) {
      seen.add(point.id);
      const entry = this.placed.get(point.id);
      if (!entry || entry.point.shape !== point.shape) {
        if (entry) this.removeMarker(point.id, entry);
        created.push(point);
        continue;
      }
      if (!this.looksDifferent(entry.point, point)) {
        entry.point = point;
        continue;
      }
      entry.marker.setStyle(this.styleOf(point));
      entry.marker.setRadius(point.radius * this.markerScale);
      if (point.emphasis === 'solid' || point.highlighted) raised.push(entry.marker);
      entry.point = point;
    }
    for (const [id, entry] of this.placed) {
      if (!seen.has(id)) this.removeMarker(id, entry);
    }
    created.sort((a, b) => this.drawOrderOf(a) - this.drawOrderOf(b)).forEach((point) => this.addMarker(point));
    raised.forEach((marker) => marker.bringToFront());
  }

  private drawOrderOf(point: RealmMapPoint): number {
    if (point.highlighted) return 2;
    return point.emphasis === 'solid' ? 1 : 0;
  }

  private looksDifferent(previous: RealmMapPoint, next: RealmMapPoint): boolean {
    return (
      previous.color !== next.color ||
      previous.emphasis !== next.emphasis ||
      previous.highlighted !== next.highlighted ||
      previous.radius !== next.radius
    );
  }

  private addMarker(point: RealmMapPoint): void {
    const options = { ...this.styleOf(point), radius: point.radius * this.markerScale };
    const marker =
      point.shape === 'diamond'
        ? new this.DiamondMarker([-point.y, point.x], options)
        : this.L.circleMarker([-point.y, point.x], options);
    this.placed.set(point.id, { marker, point });
    this.idByMarker.set(marker, point.id);
    this.pointsLayer.addLayer(marker);
  }

  private removeMarker(id: string, entry: PlacedMarker): void {
    this.pointsLayer.removeLayer(entry.marker);
    this.idByMarker.delete(entry.marker);
    this.placed.delete(id);
  }

  private styleOf(point: RealmMapPoint): Leaflet.PathOptions {
    const highlight = point.highlighted ? { color: REALM_MAP_HIGHLIGHT_COLOR, weight: 2.5, opacity: 1 } : {};
    if (point.emphasis === 'faded') {
      return { color: point.color, weight: 1, opacity: 0.6, fillColor: point.color, fillOpacity: 0.22, ...highlight };
    }
    return {
      color: 'rgba(6, 10, 14, 0.9)',
      weight: 1,
      opacity: 1,
      fillColor: point.color,
      fillOpacity: 0.95,
      ...highlight,
    };
  }

  private applyScale(): void {
    if (!this.map) return;
    const zoomGain = this.map.getZoom() - this.fitZoom;
    const stageFactor = Math.min(1.15, Math.max(0.5, this.map.getSize().x / 800));
    this.markerScale = stageFactor * Math.min(4.5, Math.max(0.8, Math.SQRT2 ** zoomGain));
    this.placed.forEach(({ marker, point }) => marker.setRadius(point.radius * this.markerScale));
    this.map
      .getContainer()
      .classList.toggle('show-ticks', this.gridStep() * 2 ** this.map.getZoom() >= MIN_TICK_SPACING_PX);
  }

  private showTooltip(layer: Leaflet.Layer): void {
    const id = this.idByMarker.get(layer);
    const point = id ? this.placed.get(id)?.point : undefined;
    if (!point || !this.map) return;
    const content =
      `<strong>${this.escapeHtml(point.title)}</strong>` +
      (point.subtitle ? `<span>${this.escapeHtml(point.subtitle)}</span>` : '') +
      `<span class="rmap-tooltip-pos">${point.x} : ${point.y}</span>`;
    this.tooltip.setLatLng([-point.y, point.x]).setContent(content);
    this.map.openTooltip(this.tooltip);
  }

  private onPointClick(layer: Leaflet.Layer): void {
    this.lastLayerClickAt = Date.now();
    if (this.picking()) return;
    const id = this.idByMarker.get(layer) ?? null;
    this.zone.run(() => this.pointSelected.emit(id));
  }

  private onMapClick(latlng: Leaflet.LatLng): void {
    if (this.picking()) {
      const coords = this.toWorld(latlng);
      if (coords) this.zone.run(() => this.picked.emit(coords));
      return;
    }
    if (Date.now() - this.lastLayerClickAt < LAYER_CLICK_GUARD_MS) return;
    this.zone.run(() => this.pointSelected.emit(null));
  }

  private updateCursor(latlng: Leaflet.LatLng | null): void {
    const coords = latlng ? this.toWorld(latlng) : null;
    const label = coords ? `${coords.x} : ${coords.y}` : null;
    if (label !== this.cursor()) this.cursor.set(label);
  }

  private toWorld(latlng: Leaflet.LatLng): { x: number; y: number } | null {
    const x = Math.round(latlng.lng);
    const y = Math.round(-latlng.lat);
    const inside =
      x >= REALM_WORLD_EXTENT.minX &&
      x <= REALM_WORLD_EXTENT.maxX &&
      y >= REALM_WORLD_EXTENT.minY &&
      y <= REALM_WORLD_EXTENT.maxY;
    return inside ? { x, y } : null;
  }

  private drawOrigin(origin: RealmMapOrigin | null, rings: number[]): void {
    const L = this.L;
    this.originLayer.clearLayers();
    if (!origin) return;
    for (const radius of rings) {
      L.circle([-origin.y, origin.x], {
        radius,
        color: '#ffffff',
        weight: 1,
        opacity: 0.55,
        dashArray: '3 6',
        fill: false,
        interactive: false,
      }).addTo(this.originLayer);
      // eslint-disable-next-line unicorn/no-keyword-prefix -- Leaflet option name
      const icon = L.divIcon({ className: 'rmap-ring-label', html: `<span>${radius}</span>`, iconSize: [0, 0] });
      L.marker([-origin.y + radius, origin.x], { icon, interactive: false, keyboard: false }).addTo(this.originLayer);
    }
    const pin = L.divIcon({
      // eslint-disable-next-line unicorn/no-keyword-prefix -- Leaflet option name
      className: 'rmap-origin',
      html:
        '<span class="rmap-origin-pin"><i class="fa-solid fa-chess-rook"></i></span>' +
        `<span class="rmap-origin-label">${this.escapeHtml(origin.label)}</span>`,
      iconSize: [0, 0],
    });
    L.marker([-origin.y, origin.x], { icon: pin, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(
      this.originLayer,
    );
  }

  private drawSelection(selectedId: string | null): void {
    this.selectionMarker?.remove();
    this.selectionMarker = null;
    const point = selectedId ? this.placed.get(selectedId)?.point : undefined;
    if (!point || !this.map) return;
    // eslint-disable-next-line unicorn/no-keyword-prefix -- Leaflet option name
    const icon = this.L.divIcon({ className: 'rmap-selection', html: '<span></span>', iconSize: [0, 0] });
    this.selectionMarker = this.L.marker([-point.y, point.x], {
      icon,
      interactive: false,
      keyboard: false,
      zIndexOffset: 900,
    }).addTo(this.map);
  }

  private boundsOf(extent: RealmMapExtent): Leaflet.LatLngBounds {
    return this.L.latLngBounds([-extent.maxY - 0.5, extent.minX - 0.5], [-extent.minY + 0.5, extent.maxX + 0.5]);
  }

  private escapeHtml(text: string): string {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replaceAll(/["&'<>]/g, (char) => entities[char]);
  }
}
