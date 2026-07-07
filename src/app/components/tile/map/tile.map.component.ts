import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ActivityTypes, EventInterface } from '@sports-alliance/sports-lib';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import { TileAbstractDirective } from '../tile-abstract.directive';
import { MapStyleName } from '../../../services/map/map-style.types';
import type {
  AppDashboardMapTileSource,
  AppDashboardTileEventFilterRange,
  AppDashboardTileEventFiltersInterface,
} from '../../../models/app-user.interface';
import type { DashboardTileEventNavigationDirection } from '../../../helpers/dashboard-tile-event-filters.helper';

@Component({
  selector: 'app-tile-map',
  templateUrl: './tile.map.component.html',
  styleUrls: ['../tile.abstract.css', './tile.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class TileMapComponent extends TileAbstractDirective {
  @Input() tileName = 'Map';
  @Input() mapSource: AppDashboardMapTileSource = 'events';
  @Input() mapStyle: MapStyleName = 'default';
  @Input() showActions!: boolean;
  @Input() enableDesktopDrag = false;
  @Input() clusterMarkers!: boolean;
  @Input() events: EventInterface[] = [];
  @Input() routePreviews: FirestoreRouteJSON[] = [];
  @Input() eventFilters?: AppDashboardTileEventFiltersInterface | null;
  @Input() canNavigateTileEventsNewer = false;
  @Output() editInDashboardManager = new EventEmitter<number>();
  @Output() eventFilterRangeChange = new EventEmitter<AppDashboardTileEventFilterRange>();
  @Output() eventFilterActivityTypesChange = new EventEmitter<ActivityTypes[]>();
  @Output() eventFilterNavigate = new EventEmitter<DashboardTileEventNavigationDirection>();

  onEditInDashboardManager(order: number): void {
    this.editInDashboardManager.emit(order);
  }
}
