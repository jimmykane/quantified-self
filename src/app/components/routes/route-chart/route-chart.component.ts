import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import {
  ChartCursorBehaviours,
  UserUnitSettingsInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { SharedModule } from '../../../modules/shared.module';
import { TrackChartPanelModel } from '../../../helpers/track-chart-panel.model';
import { buildRouteChartPanels, RouteChartPanelsResult, ROUTE_CHART_POINT_INDEX_X_AXIS_TYPE } from '../../../helpers/route-echarts-data.helper';
import { RouteSegmentDetailView } from '../../../helpers/route-detail.helper';
import { AppUserUtilities } from '../../../utils/app.user.utilities';

@Component({
  selector: 'app-route-chart',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './route-chart.component.html',
  styleUrls: ['./route-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteChartComponent implements OnChanges {
  @Input() segments: RouteSegmentDetailView[] = [];
  @Input() userUnitSettings: UserUnitSettingsInterface | null = null;
  @Input() darkTheme = false;
  @Input() waterMark = '';

  public chartPanels: TrackChartPanelModel[] = [];
  public xAxisType: XAxisTypes = ROUTE_CHART_POINT_INDEX_X_AXIS_TYPE;
  public xAxisLabel = 'Point index';
  public hasPanels = false;
  public readonly cursorBehaviour = ChartCursorBehaviours.ZoomX;
  public readonly strokeWidth = AppUserUtilities.getDefaultChartStrokeWidth();
  public readonly fillOpacity = AppUserUtilities.getDefaultChartFillOpacity();

  ngOnChanges(_changes: SimpleChanges): void {
    this.rebuildPanels();
  }

  private rebuildPanels(): void {
    const result: RouteChartPanelsResult = buildRouteChartPanels(this.segments, this.userUnitSettings);
    this.chartPanels = result.panels;
    this.xAxisType = result.xAxisType;
    this.xAxisLabel = result.xAxisLabel;
    this.hasPanels = result.panels.length > 0;
  }
}
