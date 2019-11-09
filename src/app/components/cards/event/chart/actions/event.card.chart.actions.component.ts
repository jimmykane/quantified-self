import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import {UserSettingsService} from '../../../../../services/app.user.settings.service';
import {XAxisTypes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {User} from 'quantified-self-lib/lib/users/user';
import {UserService} from '../../../../../services/app.user.service';

@Component({
  selector: 'app-event-card-chart-actions',
  templateUrl: './event.card.chart.actions.component.html',
  styleUrls: ['./event.card.chart.actions.component.css'],
  providers: [],
})

export class EventCardChartActionsComponent implements OnChanges {
  @Input() user: User;
  @Input() xAxisType: XAxisTypes;
  @Input() showAllData: boolean;
  @Input() showLaps: boolean;
  @Input() showGrid: boolean;
  @Input() stackYAxes: boolean;
  @Input() dataSmoothingLevel: number;
  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showGridChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() stackYAxesChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() xAxisTypeChange: EventEmitter<XAxisTypes> = new EventEmitter<XAxisTypes>();
  @Output() dataSmoothingLevelChange: EventEmitter<number> = new EventEmitter<number>();

  public xAxisTypes = XAxisTypes;

  constructor(
    private userService: UserService,
    private userSettingsService: UserSettingsService) {
  }

  async somethingChanged(event) {
    if (this.user) {
      this.user.settings.chartSettings.xAxisType = this.xAxisType;
      this.user.settings.chartSettings.dataSmoothingLevel = this.dataSmoothingLevel;
      this.user.settings.chartSettings.showAllData = this.showAllData;
      this.user.settings.chartSettings.showLaps = this.showLaps;
      this.user.settings.chartSettings.showGrid = this.showGrid;
      this.user.settings.chartSettings.stackYAxes = this.stackYAxes;
      await this.userService.updateUserProperties(this.user, {settings: this.user.settings})
    }
    this.xAxisTypeChange.emit(this.xAxisType);
    this.showAllDataChange.emit(this.showAllData);
    this.showLapsChange.emit(this.showLaps);
    this.showGridChange.emit(this.showGrid);
    this.stackYAxesChange.emit(this.stackYAxes);
    this.dataSmoothingLevelChange.emit(this.dataSmoothingLevel);
  }

  formatLabel(value: number | null) {
    if (!value) {
      return '';
    }
    return `${((value - 0.5) * 100 / 20).toFixed(0)}%`
  }

  ngOnChanges(simpleChanges) {
  }
}
