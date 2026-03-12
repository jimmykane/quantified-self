import { Component } from '@angular/core';
import { MapLayersActionsBaseDirective } from '../shared/map-layers-actions-base.directive';

@Component({
  selector: 'app-my-tracks-map-layers-control',
  templateUrl: './my-tracks-map-layers-control.component.html',
  styleUrls: ['./my-tracks-map-layers-control.component.css'],
  standalone: false
})
export class MyTracksMapLayersControlComponent extends MapLayersActionsBaseDirective { }
