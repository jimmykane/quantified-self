import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ChartRangeSelectorOption } from '../../charts/shared/chart-range-selector/chart-range-selector.component';
import {
  DASHBOARD_TILE_EVENT_RANGE_OPTIONS,
  dashboardTileEventRangeDays,
  normalizeDashboardTileEventFilters,
  normalizeDashboardTileEventFilterRange,
  type DashboardTileEventNavigationDirection,
} from '../../../helpers/dashboard-tile-event-filters.helper';
import type {
  AppDashboardTileEventFilterRange,
  AppDashboardTileEventFiltersInterface,
} from '../../../models/app-user.interface';

@Component({
  selector: 'app-dashboard-tile-event-filters',
  templateUrl: './dashboard-tile-event-filters.component.html',
  styleUrls: ['./dashboard-tile-event-filters.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DashboardTileEventFiltersComponent implements OnChanges {
  @Input() eventFilters?: AppDashboardTileEventFiltersInterface | null;
  @Input() disabled = false;
  @Input() canNavigateNewer = false;
  @Output() rangeChange = new EventEmitter<AppDashboardTileEventFilterRange>();
  @Output() activityTypesChange = new EventEmitter<ActivityTypes[]>();
  @Output() navigate = new EventEmitter<DashboardTileEventNavigationDirection>();

  public readonly rangeSelectorOptions: ReadonlyArray<ChartRangeSelectorOption> = DASHBOARD_TILE_EVENT_RANGE_OPTIONS.map(option => ({
    value: option.range,
    label: option.buttonLabel,
    shortLabel: option.shortLabel,
    menuLabel: option.label,
  }));

  public normalizedFilters = normalizeDashboardTileEventFilters(null);
  public selectedRange: AppDashboardTileEventFilterRange = normalizeDashboardTileEventFilterRange(this.normalizedFilters.range);
  public selectedActivityTypes: ActivityTypes[] = [];
  public showNavigation = dashboardTileEventRangeDays(this.selectedRange) !== null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['eventFilters']) {
      return;
    }
    this.refreshFilterState();
  }

  onRangeSelection(value: string): void {
    this.rangeChange.emit(normalizeDashboardTileEventFilterRange(value));
  }

  onActivityTypesChange(activityTypes: ActivityTypes[]): void {
    this.selectedActivityTypes = activityTypes || [];
    this.activityTypesChange.emit(this.selectedActivityTypes);
  }

  onNavigate(direction: DashboardTileEventNavigationDirection): void {
    if (!this.showNavigation) {
      return;
    }
    if (direction === 'newer' && !this.canNavigateNewer) {
      return;
    }
    this.navigate.emit(direction);
  }

  private refreshFilterState(): void {
    this.normalizedFilters = normalizeDashboardTileEventFilters(this.eventFilters);
    this.selectedRange = normalizeDashboardTileEventFilterRange(this.normalizedFilters.range);
    this.showNavigation = dashboardTileEventRangeDays(this.selectedRange) !== null;
    this.selectedActivityTypes = this.normalizedFilters.activityTypes || [];
  }
}
