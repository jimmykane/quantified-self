import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Directive, Input } from '@angular/core';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { LoadingAbstractDirective } from '../../loading/loading-abstract.directive';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { TileAbstract } from '../tile.abstract';

@Component({
  selector: 'app-tile-map',
  templateUrl: './tile.map.component.html',
  styleUrls: ['../tile.abstract.css', './tile.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class TileMapComponent extends TileAbstract {
  @Input() mapType: MapTypes;
  @Input() mapTheme: MapThemes;
  @Input() showActions: boolean;
  @Input() showHeatMap: boolean;
  @Input() clusterMarkers: boolean;
  @Input() events: EventInterface[] = [];

  public mapTypes = MapTypes;
  public mapThemes = MapThemes;
}
