import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChartTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { AiInsightsOkResponse } from '@shared/ai-insights.types';
import { buildAggregatedChartRows } from '../../helpers/aggregated-chart-row.helper';
import { AppChartsModule } from '../../modules/app-charts.module';

@Component({
  selector: 'app-ai-insights-chart',
  standalone: true,
  imports: [CommonModule, AppChartsModule],
  templateUrl: './ai-insights-chart.component.html',
  styleUrls: ['./ai-insights-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsChartComponent {
  readonly response = input.required<AiInsightsOkResponse>();
  readonly darkTheme = input(false);
  readonly useAnimations = input(false);
  readonly userUnitSettings = input<UserUnitSettingsInterface | null>(null);

  readonly chartRows = computed(() => buildAggregatedChartRows(this.response().aggregation));
  readonly chartType = computed(() => this.response().presentation.chartType);
  readonly chartDataType = computed(() => this.response().query.dataType);
  readonly chartDataValueType = computed(() => this.response().query.valueType);
  readonly chartDataCategoryType = computed(() => this.response().query.categoryType);
  readonly chartDataTimeInterval = computed(() => this.response().aggregation.resolvedTimeInterval);
  readonly renderPieChart = computed(() => this.chartType() === ChartTypes.Pie);
  readonly renderLineChart = computed(() =>
    this.chartType() === ChartTypes.LinesHorizontal
    || this.chartType() === ChartTypes.LinesVertical
  );
  readonly renderColumnChart = computed(() =>
    this.chartType() === ChartTypes.ColumnsHorizontal
    || this.chartType() === ChartTypes.ColumnsVertical
    || this.chartType() === ChartTypes.PyramidsVertical
  );
  readonly chartVertical = computed(() =>
    this.chartType() !== ChartTypes.ColumnsHorizontal
    && this.chartType() !== ChartTypes.LinesHorizontal
  );
  readonly columnsType = computed<'columns' | 'pyramids'>(() =>
    this.chartType() === ChartTypes.PyramidsVertical ? 'pyramids' : 'columns'
  );
}
