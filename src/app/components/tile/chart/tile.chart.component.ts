import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TimeIntervals
} from '@sports-alliance/sports-lib';
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
  @Input() darkTheme = false;
  @Input() showActions: boolean;
  @Input() dataTimeInterval: TimeIntervals;
  @Input() data: any;

  public chartTypes = ChartTypes;
  public isTileActionSaving = false;

  onTileActionSaving(isSaving: boolean): void {
    this.isTileActionSaving = isSaving === true;
  }

}
