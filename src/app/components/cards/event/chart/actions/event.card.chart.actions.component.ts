import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import {Router} from '@angular/router';
import {EventService} from '../../../../../services/app.event.service';
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
  @Input() dataSmoothingLevel: number;
  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
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
      await this.userService.updateUserProperties(this.user, {settings: this.user.settings})
    }
    this.xAxisTypeChange.emit(this.xAxisType);
    this.showAllDataChange.emit(this.showAllData);
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
