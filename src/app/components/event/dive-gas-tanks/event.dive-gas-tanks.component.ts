import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  inject,
} from '@angular/core';
import {
  ActivityInterface,
  DiveGasRecord,
  DiveMessageIndex,
  DiveTankSummaryRecord,
  DiveTankUpdateRecord,
} from '@sports-alliance/sports-lib';
import { getEventDiveSourceRecordActivities } from '../../../helpers/event-dive-source-records.helper';

type DiveSourceRecordTableRow = Record<string, string>;

interface DiveSourceActivityView {
  key: string;
  label: string;
  gasRows: DiveSourceRecordTableRow[];
  tankSummaryRows: DiveSourceRecordTableRow[];
  tankUpdateRows: DiveSourceRecordTableRow[];
}

interface PendingDiveSourceActivityView extends Omit<DiveSourceActivityView, 'label'> {
  baseLabel: string;
}

const MISSING_VALUE = '—';

@Component({
  selector: 'app-event-dive-gas-tanks',
  templateUrl: './event.dive-gas-tanks.component.html',
  styleUrls: ['./event.dive-gas-tanks.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventDiveGasTanksComponent implements OnChanges {
  @Input() selectedActivities: ActivityInterface[] = [];

  public readonly gasColumns = ['messageIndex', 'oxygenContent', 'heliumContent', 'status', 'mode'];
  public readonly gasColumnLabels: Record<string, string> = {
    messageIndex: 'Index',
    oxygenContent: 'O₂',
    heliumContent: 'He',
    status: 'Status',
    mode: 'Mode',
  };
  public readonly tankSummaryColumns = [
    'timestamp',
    'sensor',
    'startPressure',
    'endPressure',
    'volumeUsed',
  ];
  public readonly tankSummaryColumnLabels: Record<string, string> = {
    timestamp: 'Timestamp (UTC)',
    sensor: 'Sensor',
    startPressure: 'Start pressure',
    endPressure: 'End pressure',
    volumeUsed: 'Volume used',
  };
  public readonly tankUpdateColumns = ['timestamp', 'sensor', 'pressure'];
  public readonly tankUpdateColumnLabels: Record<string, string> = {
    timestamp: 'Timestamp (UTC)',
    sensor: 'Sensor',
    pressure: 'Pressure',
  };
  public sourceActivityViews: DiveSourceActivityView[] = [];

  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  public ngOnChanges(): void {
    const pendingViews = getEventDiveSourceRecordActivities(this.selectedActivities).map((sourceActivity, index) => ({
      key: this.buildActivityKey(sourceActivity.activity, index),
      baseLabel: this.resolveActivityLabel(sourceActivity.activity),
      gasRows: sourceActivity.records.gases.map((record) => this.buildGasRow(record)),
      tankSummaryRows: sourceActivity.records.tankSummaries.map((record) => this.buildTankSummaryRow(record)),
      tankUpdateRows: sourceActivity.records.tankUpdates.map((record) => this.buildTankUpdateRow(record)),
    }));

    this.sourceActivityViews = this.applyActivityLabels(pendingViews);
    this.changeDetectorRef.markForCheck();
  }

  private buildActivityKey(activity: ActivityInterface, index: number): string {
    return `${activity.getID() || 'activity'}-${index}`;
  }

  private resolveActivityLabel(activity: ActivityInterface): string {
    return `${activity.type || 'Diving'}`.trim();
  }

  private applyActivityLabels(pendingViews: PendingDiveSourceActivityView[]): DiveSourceActivityView[] {
    const labelCounts = pendingViews.reduce<Map<string, number>>((counts, view) => {
      counts.set(view.baseLabel, (counts.get(view.baseLabel) || 0) + 1);
      return counts;
    }, new Map());
    const labelIndexes = new Map<string, number>();

    return pendingViews.map(({ baseLabel, ...view }) => {
      const count = labelCounts.get(baseLabel) || 0;
      const index = (labelIndexes.get(baseLabel) || 0) + 1;
      labelIndexes.set(baseLabel, index);
      return {
        ...view,
        label: count > 1 ? `${baseLabel} ${index}` : baseLabel,
      };
    });
  }

  private buildGasRow(record: DiveGasRecord): DiveSourceRecordTableRow {
    return {
      messageIndex: this.formatMessageIndex(record.messageIndex),
      oxygenContent: this.formatSourceNumberWithUnit(record.oxygenContent, '%'),
      heliumContent: this.formatSourceNumberWithUnit(record.heliumContent, '%'),
      status: this.formatEnum(record.status),
      mode: this.formatEnum(record.mode),
    };
  }

  private buildTankSummaryRow(record: DiveTankSummaryRecord): DiveSourceRecordTableRow {
    return {
      timestamp: this.formatTimestamp(record.timestamp),
      sensor: this.formatSourceNumber(record.sensor),
      startPressure: this.formatSourceNumberWithUnit(record.startPressure, 'bar'),
      endPressure: this.formatSourceNumberWithUnit(record.endPressure, 'bar'),
      volumeUsed: this.formatSourceNumberWithUnit(record.volumeUsed, 'L'),
    };
  }

  private buildTankUpdateRow(record: DiveTankUpdateRecord): DiveSourceRecordTableRow {
    return {
      timestamp: this.formatTimestamp(record.timestamp),
      sensor: this.formatSourceNumber(record.sensor),
      pressure: this.formatSourceNumberWithUnit(record.pressure, 'bar'),
    };
  }

  private formatMessageIndex(messageIndex: DiveMessageIndex | undefined): string {
    if (!messageIndex) {
      return MISSING_VALUE;
    }

    const flags = [
      messageIndex.selected ? 'selected' : null,
      messageIndex.reserved ? 'reserved' : null,
    ].filter((flag): flag is string => !!flag);
    return flags.length > 0
      ? `${this.formatSourceNumber(messageIndex.value)} (${flags.join(', ')})`
      : this.formatSourceNumber(messageIndex.value);
  }

  private formatEnum(value: string | number | undefined): string {
    return value === undefined ? MISSING_VALUE : `${value}`;
  }

  private formatSourceNumber(value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? `${value}`
      : MISSING_VALUE;
  }

  private formatSourceNumberWithUnit(value: number | undefined, unit: string): string {
    const formattedValue = this.formatSourceNumber(value);
    return formattedValue === MISSING_VALUE ? MISSING_VALUE : `${formattedValue} ${unit}`;
  }

  private formatTimestamp(value: Date | undefined): string {
    return value instanceof Date && Number.isFinite(value.getTime())
      ? value.toISOString()
      : MISSING_VALUE;
  }
}
