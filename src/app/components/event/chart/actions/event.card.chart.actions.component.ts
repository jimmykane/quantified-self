import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { XAxisTypes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
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

  constructor() {
  }

  async somethingChanged(prop?: string) {
    if (prop === 'xAxisType') {
      this.xAxisTypeChange.emit(this.xAxisType);
    } else if (prop === 'showAllData') {
      this.showAllDataChange.emit(this.showAllData);
    } else if (prop === 'showLaps') {
      this.showLapsChange.emit(this.showLaps);
    } else if (prop === 'stackYAxes') {
      this.stackYAxesChange.emit(this.stackYAxes);
    } else {
      // Fallback for safety if called without prop
      this.xAxisTypeChange.emit(this.xAxisType);
      this.showAllDataChange.emit(this.showAllData);
      this.showLapsChange.emit(this.showLaps);
      this.stackYAxesChange.emit(this.stackYAxes);
    }

    this.analyticsService.logEvent('event_chart_settings_change', { property: prop });
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
