import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input } from '@angular/core';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TileChartSettingsInterface
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { ChartThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';
import { SummariesChartDataDateRages } from '../../summaries/summaries.component';
import { TileAbstract } from "../tile.abstract";
import { User } from "@sports-alliance/sports-lib/lib/users/user";

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
  @Input() filterLowValues: boolean;
  @Input() showActions: boolean;
  @Input() dataDateRange: SummariesChartDataDateRages;
  @Input() data: any;

  public chartTypes = ChartTypes;

}
