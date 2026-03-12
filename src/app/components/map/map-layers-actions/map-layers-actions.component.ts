import { Component } from '@angular/core';
import { MapLayersActionsBaseDirective } from '../shared/map-layers-actions-base.directive';

@Component({
  selector: 'app-map-layers-actions',
  templateUrl: './map-layers-actions.component.html',
  styleUrls: ['./map-layers-actions.component.css'],
  standalone: false
})
export class MapLayersActionsComponent extends MapLayersActionsBaseDirective { }
