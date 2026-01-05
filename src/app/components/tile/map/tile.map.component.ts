import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Directive, Input } from '@angular/core';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib';
import { EventInterface } from '@sports-alliance/sports-lib';
import { LoadingAbstractDirective } from '../../loading/loading-abstract.directive';
import { User } from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';

@Component({
    selector: 'app-tile-map',
    templateUrl: './tile.map.component.html',
    styleUrls: ['../tile.abstract.css', './tile.map.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})

export class TileMapComponent extends TileAbstractDirective {
  @Input() mapType: MapTypes;
  @Input() mapTheme: MapThemes;
  @Input() showActions: boolean;
  @Input() showHeatMap: boolean;
  @Input() clusterMarkers: boolean;
  @Input() events: EventInterface[] = [];

  public mapTypes = MapTypes;
  public mapThemes = MapThemes;
}
