import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TimeIntervals
} from '@sports-alliance/sports-lib';
import { ChartThemes } from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';

@Component({
  selector: 'app-tile-chart',
  templateUrl: './tile.chart.component.html',
  styleUrls: ['../tile.abstract.css', './tile.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class TileChartComponent extends TileAbstractDirective {
  @Input() chartType: ChartTypes;
  @Input() dataType: string;
  @Input() dataValueType: ChartDataValueTypes;
  @Input() dataCategoryType: ChartDataCategoryTypes;
  @Input() chartTheme: ChartThemes;
  @Input() showActions: boolean;
  @Input() dataTimeInterval: TimeIntervals;
  @Input() data: any;

  public chartTypes = ChartTypes;

}
