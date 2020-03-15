import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output} from '@angular/core';
import {XAxisTypes} from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {AppUserService} from '../../../../../services/app.user.service';
import { AngularFireAnalytics } from '@angular/fire/analytics';

@Component({
  selector: 'app-event-card-chart-actions',
  templateUrl: './event.card.chart.actions.component.html',
  styleUrls: ['./event.card.chart.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardChartActionsComponent implements OnChanges {
  @Input() user: User;
  @Input() xAxisType: XAxisTypes;
  @Input() showAllData: boolean;
  @Input() showLaps: boolean;
  @Input() stackYAxes: boolean;
  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() stackYAxesChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() xAxisTypeChange: EventEmitter<XAxisTypes> = new EventEmitter<XAxisTypes>();

  public xAxisTypes = XAxisTypes;

  constructor(
      private userService: AppUserService, private afa: AngularFireAnalytics) {
  }

  async somethingChanged(event) {
    if (this.user) {
      this.user.settings.chartSettings.xAxisType = this.xAxisType;
      this.user.settings.chartSettings.showAllData = this.showAllData;
      this.user.settings.chartSettings.showLaps = this.showLaps;
      this.user.settings.chartSettings.stackYAxes = this.stackYAxes;
      await this.userService.updateUserProperties(this.user, {settings: this.user.settings})
    }
    this.xAxisTypeChange.emit(this.xAxisType);
    this.showAllDataChange.emit(this.showAllData);
    this.showLapsChange.emit(this.showLaps);
    this.stackYAxesChange.emit(this.stackYAxes);
    return this.afa.logEvent('event_chart_settings_change');
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
