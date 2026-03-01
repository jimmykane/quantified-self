import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { XAxisTypes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { EventInterface } from '@sports-alliance/sports-lib';

interface ChartSeriesMenuItem {
  dataType: string;
  label: string;
  color: string;
  visible: boolean;
}

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
  @Input() showSeriesMenu = false;
  @Input() seriesMenuSummary = '';
  @Input() seriesMenuItems: ChartSeriesMenuItem[] = [];
  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() xAxisTypeChange: EventEmitter<XAxisTypes> = new EventEmitter<XAxisTypes>();
  @Output() seriesVisibilityToggle = new EventEmitter<{ dataType: string; visible: boolean }>();
  @Output() showAllSeries = new EventEmitter<void>();

  public xAxisTypes = XAxisTypes;
  private analyticsService = inject(AppAnalyticsService);

  public get shouldShowAllSeriesAction(): boolean {
    return this.seriesMenuItems.length > 0 && this.seriesMenuItems.every((item) => !item.visible);
  }

  public get visibleSeriesCount(): number {
    return this.seriesMenuItems.filter((item) => item.visible).length;
  }

  public get totalSeriesCount(): number {
    return this.seriesMenuItems.length;
  }

  constructor() {
  }

  async onShowLapsToggle(checked: boolean) {
    this.showLaps = checked;
    await this.somethingChanged('showLaps');
  }

  async onShowAllDataToggle(checked: boolean) {
    this.showAllData = checked;
    await this.somethingChanged('showAllData');
  }

  async onXAxisTypeChange(value: XAxisTypes) {
    this.xAxisType = value;
    await this.somethingChanged('xAxisType');
  }

  async somethingChanged(prop?: string) {
    if (prop === 'xAxisType') {
      this.xAxisTypeChange.emit(this.xAxisType);
    } else if (prop === 'showAllData') {
      this.showAllDataChange.emit(this.showAllData);
    } else if (prop === 'showLaps') {
      this.showLapsChange.emit(this.showLaps);
    } else {
      // Fallback for safety if called without prop
      this.xAxisTypeChange.emit(this.xAxisType);
      this.showAllDataChange.emit(this.showAllData);
      this.showLapsChange.emit(this.showLaps);
    }

    this.analyticsService.logEvent('event_chart_settings_change', { property: prop });
  }

  onSeriesVisibilityToggle(dataType: string, visible: boolean): void {
    this.seriesVisibilityToggle.emit({ dataType, visible });
  }

  onShowAllSeries(): void {
    this.showAllSeries.emit();
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
