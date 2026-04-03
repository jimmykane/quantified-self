import { Component, Input, OnInit } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';
import {
  type DashboardChartType,
  isDashboardRecoveryNowChartType,
} from '../../../../helpers/dashboard-special-chart-types';

@Component({
  selector: 'app-tile-chart-actions',
  templateUrl: './tile.chart.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.chart.actions.component.css'],
  providers: [],
  standalone: false
})
export class TileChartActionsComponent extends TileActionsAbstractDirective implements OnInit {
  @Input() chartType: DashboardChartType;
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes;
  @Input() chartTimeInterval: TimeIntervals;
  @Input() chartOrder: number;

  constructor(
    userService: AppUserService) {
    super(userService);
  }

  override async deleteTile(event: unknown) {
    if (isDashboardRecoveryNowChartType(this.chartType)) {
      (this.user.settings.dashboardSettings as { dismissedCuratedRecoveryNowTile?: boolean }).dismissedCuratedRecoveryNowTile = true;
    }
    return super.deleteTile(event);
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }
}
