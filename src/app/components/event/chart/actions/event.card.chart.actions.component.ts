import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { ChartCursorBehaviours, XAxisTypes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { EventInterface } from '@sports-alliance/sports-lib';
import { MenuRadioListOption } from '../../../shared/menu-radio-list/menu-radio-list.component';

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
  @Input() cursorBehaviour: ChartCursorBehaviours = ChartCursorBehaviours.ZoomX;
  @Input() showSeriesMenu = false;
  @Input() seriesMenuSummary = '';
  @Input() seriesMenuItems: ChartSeriesMenuItem[] = [];
  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() xAxisTypeChange: EventEmitter<XAxisTypes> = new EventEmitter<XAxisTypes>();
  @Output() cursorBehaviourChange = new EventEmitter<ChartCursorBehaviours>();
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

  public get xAxisOptions(): MenuRadioListOption<XAxisTypes>[] {
    return Object.entries(this.xAxisTypes).map(([label, value]) => ({
      label,
      value: value as XAxisTypes,
    }));
  }

  public get cursorBehaviourIcon(): string {
    return this.cursorBehaviour === ChartCursorBehaviours.SelectX ? 'select_all' : 'zoom_in';
  }

  public get cursorBehaviourTooltip(): string {
    return this.cursorBehaviour === ChartCursorBehaviours.SelectX
      ? 'Selection mode active. Click to switch to zoom mode.'
      : 'Zoom mode active. Click to switch to selection mode.';
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

  async onCursorBehaviourChange(value: ChartCursorBehaviours) {
    this.cursorBehaviour = value;
    await this.somethingChanged('cursorBehaviour');
  }

  async onCursorBehaviourToggle() {
    await this.onCursorBehaviourChange(
      this.cursorBehaviour === ChartCursorBehaviours.SelectX
        ? ChartCursorBehaviours.ZoomX
        : ChartCursorBehaviours.SelectX
    );
  }

  async somethingChanged(prop?: string) {
    if (prop === 'xAxisType') {
      this.xAxisTypeChange.emit(this.xAxisType);
    } else if (prop === 'cursorBehaviour') {
      this.cursorBehaviourChange.emit(this.cursorBehaviour);
    } else if (prop === 'showAllData') {
      this.showAllDataChange.emit(this.showAllData);
    } else if (prop === 'showLaps') {
      this.showLapsChange.emit(this.showLaps);
    } else {
      // Fallback for safety if called without prop
      this.xAxisTypeChange.emit(this.xAxisType);
      this.cursorBehaviourChange.emit(this.cursorBehaviour);
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
