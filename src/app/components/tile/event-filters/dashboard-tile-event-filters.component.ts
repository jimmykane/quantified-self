import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
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
export class DashboardTileEventFiltersComponent {
  @Input() eventFilters?: AppDashboardTileEventFiltersInterface | null;
  @Input() disabled = false;
  @Input() canNavigateNewer = false;
  @Output() rangeChange = new EventEmitter<AppDashboardTileEventFilterRange>();
  @Output() activityTypesChange = new EventEmitter<ActivityTypes[]>();
  @Output() navigate = new EventEmitter<DashboardTileEventNavigationDirection>();

  public readonly rangeSelectorOptions: ReadonlyArray<ChartRangeSelectorOption> = DASHBOARD_TILE_EVENT_RANGE_OPTIONS.map(option => ({
    value: option.range,
    label: option.label,
  }));

  get normalizedFilters(): AppDashboardTileEventFiltersInterface {
    return normalizeDashboardTileEventFilters(this.eventFilters);
  }

  get selectedRange(): AppDashboardTileEventFilterRange {
    return normalizeDashboardTileEventFilterRange(this.normalizedFilters.range);
  }

  get selectedActivityTypes(): ActivityTypes[] {
    return this.normalizedFilters.activityTypes || [];
  }

  get showNavigation(): boolean {
    return dashboardTileEventRangeDays(this.selectedRange) !== null;
  }

  get activityFilterLabel(): string {
    const count = this.selectedActivityTypes.length;
    return count > 0 ? `${count} activity filters` : 'All activities';
  }

  onRangeSelection(value: string): void {
    this.rangeChange.emit(normalizeDashboardTileEventFilterRange(value));
  }

  onActivityTypesChange(activityTypes: ActivityTypes[]): void {
    this.activityTypesChange.emit(activityTypes || []);
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
}
