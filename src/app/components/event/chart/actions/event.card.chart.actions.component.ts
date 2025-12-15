import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { XAxisTypes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { EventInterface } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-event-card-chart-actions',
  templateUrl: './event.card.chart.actions.component.html',
  styleUrls: ['./event.card.chart.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardChartActionsComponent implements OnChanges {
  @Input() user: User;
  @Input() event: EventInterface;
  @Input() xAxisType: XAxisTypes;
  @Input() showAllData: boolean;
  @Input() showLaps: boolean;
  @Input() stackYAxes: boolean;
  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() stackYAxesChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() xAxisTypeChange: EventEmitter<XAxisTypes> = new EventEmitter<XAxisTypes>();

  public xAxisTypes = XAxisTypes;
  private analytics = inject(Analytics);

  constructor(
    private userService: AppUserService) {
  }

  async somethingChanged(event) {
    if (this.user) {
      this.user.settings.chartSettings.xAxisType = this.xAxisType;
      this.user.settings.chartSettings.showAllData = this.showAllData;
      this.user.settings.chartSettings.showLaps = this.showLaps;
      this.user.settings.chartSettings.stackYAxes = this.stackYAxes;
      await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
    }
    this.xAxisTypeChange.emit(this.xAxisType);
    this.showAllDataChange.emit(this.showAllData);
    this.showLapsChange.emit(this.showLaps);
    this.stackYAxesChange.emit(this.stackYAxes);
    return logEvent(this.analytics, 'event_chart_settings_change');
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
