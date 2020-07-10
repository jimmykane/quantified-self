import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TimeIntervals
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { ChartThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';
import { TileAbstract } from '../tile.abstract';

@Component({
  selector: 'app-tile-chart',
  templateUrl: './tile.chart.component.html',
  styleUrls: ['../tile.abstract.css', './tile.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class TileChartComponent extends TileAbstract {
  @Input() isLoading: boolean;
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
