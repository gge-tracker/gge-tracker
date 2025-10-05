import { Component, input } from '@angular/core';

import { LeafletLayerGroup, LeafletMap } from '@ggetracker-interfaces/leaflet-type';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [],
  templateUrl: './map.component.html',
  styleUrl: './map.component.css',
})
export class MapComponent {
  public map = input.required<LeafletMap>();
  public heatmapLayer = input.required<LeafletLayerGroup | null>();
}
