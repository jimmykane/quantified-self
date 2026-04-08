import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TimeIntervals
} from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import type { DashboardFormPoint } from '../../../helpers/dashboard-form.helper';
import type { DashboardRecoveryNowContext } from '../../../helpers/dashboard-recovery-now.helper';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  type DashboardChartType,
} from '../../../helpers/dashboard-special-chart-types';

@Component({
  selector: 'app-tile-chart',
  templateUrl: './tile.chart.component.html',
  styleUrls: ['../tile.abstract.css', './tile.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class TileChartComponent extends TileAbstractDirective {
  @Input() chartType: DashboardChartType;
  @Input() dataType: string;
  @Input() dataValueType: ChartDataValueTypes;
  @Input() dataCategoryType: ChartDataCategoryTypes;
  @Input() darkTheme = false;
  @Input() showActions: boolean;
  @Input() enableDesktopDrag = false;
  @Input() dataTimeInterval: TimeIntervals;
  @Input() data: any;
  @Input() recoveryNow?: DashboardRecoveryNowContext | null;
  @Input() absoluteLatestFormPoint?: DashboardFormPoint | null;

  public chartTypes = ChartTypes;
  public recoveryNowChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE;
  public formChartType = DASHBOARD_FORM_CHART_TYPE;
  public isTileActionSaving = false;

  onTileActionSaving(isSaving: boolean): void {
    this.isTileActionSaving = isSaving === true;
  }

}
