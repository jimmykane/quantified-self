import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { XAxisTypes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { AppUserSettingsQueryService } from '../../../../services/app.user-settings-query.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { EventInterface } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-event-card-chart-actions',
  templateUrl: './event.card.chart.actions.component.html',
  styleUrls: ['./event.card.chart.actions.component.scss'],
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
  private analyticsService = inject(AppAnalyticsService);

  private userSettingsQuery = inject(AppUserSettingsQueryService);

  constructor() {
  }

  async somethingChanged(event) {
    this.xAxisTypeChange.emit(this.xAxisType);
    this.showAllDataChange.emit(this.showAllData);
    this.showLapsChange.emit(this.showLaps);
    this.stackYAxesChange.emit(this.stackYAxes);
    if (this.user) {
      this.userSettingsQuery.updateChartSettings({
        xAxisType: this.xAxisType,
        showAllData: this.showAllData,
        showLaps: this.showLaps,
        stackYAxes: this.stackYAxes
      });
    }
    this.analyticsService.logEvent('event_chart_settings_change');
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
