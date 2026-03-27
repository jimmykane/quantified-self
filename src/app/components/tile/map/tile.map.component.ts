import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import { MapStyleName } from '../../../services/map/map-style.types';

@Component({
  selector: 'app-tile-map',
  templateUrl: './tile.map.component.html',
  styleUrls: ['../tile.abstract.css', './tile.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class TileMapComponent extends TileAbstractDirective {
  @Input() mapStyle: MapStyleName = 'default';
  @Input() showActions!: boolean;
  @Input() enableDesktopDrag = false;
  @Input() clusterMarkers!: boolean;
  @Input() events: EventInterface[] = [];
}
