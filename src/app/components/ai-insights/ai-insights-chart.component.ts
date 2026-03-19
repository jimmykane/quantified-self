import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { ChartDataCategoryTypes, ChartTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { AiInsightsAggregateOkResponse } from '@shared/ai-insights.types';
import { buildAggregatedChartRows } from '../../helpers/aggregated-chart-row.helper';
import { AppChartsModule } from '../../modules/app-charts.module';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-ai-insights-chart',
  standalone: true,
  imports: [CommonModule, AppChartsModule],
  templateUrl: './ai-insights-chart.component.html',
  styleUrls: ['./ai-insights-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsChartComponent {
  private readonly logger = inject(LoggerService);

  readonly response = input.required<AiInsightsAggregateOkResponse>();
  readonly darkTheme = input(false);
  readonly useAnimations = input(false);
  readonly userUnitSettings = input<UserUnitSettingsInterface | null>(null);

  readonly chartRows = computed(() => buildAggregatedChartRows(this.response().aggregation));
  readonly chartType = computed(() => this.response().presentation.chartType);
  readonly chartDataType = computed(() => this.response().query.dataType);
  readonly chartDataValueType = computed(() => this.response().query.valueType);
  readonly chartDataCategoryType = computed(() => this.response().query.categoryType);
  readonly chartDataTimeInterval = computed(() => this.response().aggregation.resolvedTimeInterval);
  readonly preferDateActivitySegmentation = computed(() => (
    this.chartType() === ChartTypes.ColumnsVertical
    && this.response().query.categoryType === ChartDataCategoryTypes.DateType
  ));
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

  private readonly debugChartData = effect(() => {
    const response = this.response();
    const chartRows = this.chartRows();
    const effectiveChartType = this.chartType();

    this.logger.log('[AiInsightsChartComponent] Render payload debug', {
      queryChartType: response.query.chartType,
      presentationChartType: response.presentation.chartType,
      effectiveChartType,
      categoryType: response.query.categoryType,
      valueType: response.query.valueType,
      requestedTimeInterval: response.query.requestedTimeInterval,
      resolvedTimeInterval: response.aggregation.resolvedTimeInterval,
      bucketCount: response.aggregation.buckets.length,
      firstBucketSample: response.aggregation.buckets.slice(0, 3).map(bucket => ({
        bucketKey: bucket.bucketKey,
        time: bucket.time,
        aggregateValue: bucket.aggregateValue,
        totalCount: bucket.totalCount,
        seriesKeyCount: Object.keys(bucket.seriesValues || {}).length,
        seriesKeys: Object.keys(bucket.seriesValues || {}).slice(0, 8),
      })),
      chartRowsSample: chartRows.slice(0, 3).map(row => ({
        type: row.type,
        time: row.time,
        count: row.count,
        seriesKeys: Object.keys(row).filter(key => (
          key !== 'type' && key !== 'time' && key !== 'count' && !key.endsWith('-Count')
        )),
      })),
    });
  });
}
