import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TimeIntervals
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { ChartThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';
import { TileAbstract } from '../tile.abstract';

@Component({
  selector: 'app-tile-brian-devine-chart',
  templateUrl: './tile.brian-devine.component.html',
  styleUrls: ['../tile.abstract.css', './tile.brian-devine.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class TileBrianDevineComponent extends TileAbstract {
  @Input() isLoading: boolean;
  @Input() chartTheme: ChartThemes;
  @Input() showActions: boolean;
  @Input() data: any;
  constructor() {
    super();
  }
}
