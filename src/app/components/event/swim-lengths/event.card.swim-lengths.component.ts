import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import {
  ActivityInterface,
  DataInterface,
  DataSwimPace,
  DynamicDataLoader,
  EventInterface,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { AppSwimLength, getActivitySwimLengths } from '../../../helpers/event-swim-length.helper';
import { isMergeOrBenchmarkEvent } from '../../../helpers/event-visibility.helper';

interface SwimLengthTableRow {
  '#': number;
  Lap: string;
  Duration: string;
  Distance: string;
  Type: string;
  Stroke: string;
  Strokes: string;
  'Swim Pace': string;
  'Average Cadence': string;
  'Average Heart Rate': string;
  SWOLF: string;
  Energy: string;
}

interface SwimLengthTableColumn {
  name: string;
  sticky: boolean;
}

interface SwimLengthActivityView {
  key: string;
  activity: ActivityInterface;
  label: string;
  dataSource: MatTableDataSource<SwimLengthTableRow>;
  columns: SwimLengthTableColumn[];
  columnNames: string[];
}

interface PendingSwimLengthActivityView extends Omit<SwimLengthActivityView, 'label'> {
  baseLabel: string;
}

@Component({
  selector: 'app-event-card-swim-lengths',
  templateUrl: './event.card.swim-lengths.component.html',
  styleUrls: ['./event.card.swim-lengths.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventCardSwimLengthsComponent implements OnChanges {
  @Input() event!: EventInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() unitSettings!: UserUnitSettingsInterface;

  public activitiesWithSwimLengths: ActivityInterface[] = [];
  public swimLengthViews: SwimLengthActivityView[] = [];

  constructor(private changeDetectorRef: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.updateData();
  }

  private updateData(): void {
    this.activitiesWithSwimLengths = [];
    this.swimLengthViews = [];

    if (!Array.isArray(this.selectedActivities) || this.selectedActivities.length === 0) {
      this.changeDetectorRef.markForCheck();
      return;
    }

    const pendingViews: PendingSwimLengthActivityView[] = [];

    this.selectedActivities.forEach((activity, index) => {
      const rows = this.generateSwimLengthData(activity);
      if (!rows.length) {
        return;
      }

      const key = this.buildActivityKey(activity, index);
      this.activitiesWithSwimLengths.push(activity);
      const columns = this.buildColumns(rows);
      pendingViews.push({
        key,
        activity,
        baseLabel: this.resolveActivityLabel(activity),
        dataSource: new MatTableDataSource(rows),
        columns,
        columnNames: columns.map(column => column.name),
      });
    });

    this.swimLengthViews = pendingViews.map((view, index) => {
      const { baseLabel, ...rest } = view;
      return {
        ...rest,
        label: pendingViews.length <= 1 ? baseLabel : `${baseLabel} ${index + 1}`,
      };
    });

    this.changeDetectorRef.markForCheck();
  }

  private buildActivityKey(activity: ActivityInterface, index: number): string {
    const activityID = `${activity?.getID?.() || ''}`.trim() || `activity-${index + 1}`;
    return `${activityID}-${index}`;
  }

  private generateSwimLengthData(activity: ActivityInterface): SwimLengthTableRow[] {
    return getActivitySwimLengths(activity).map((swimLength) => ({
      '#': swimLength.index,
      Lap: this.formatOptionalInteger(swimLength.lapIndex),
      Duration: this.formatDuration(swimLength),
      Distance: this.formatDistance(swimLength.distance),
      Type: this.formatLabel(swimLength.type),
      Stroke: this.formatLabel(swimLength.stroke),
      Strokes: this.formatOptionalInteger(swimLength.strokes),
      'Swim Pace': this.formatSwimPace(swimLength.avgSpeed),
      'Average Cadence': this.formatCadence(swimLength.avgCadence),
      'Average Heart Rate': this.formatHeartRate(swimLength.avgHeartRate),
      SWOLF: this.formatDecimal(swimLength.swolf),
      Energy: this.formatEnergy(swimLength.calories),
    }));
  }

  private resolveActivityLabel(activity: ActivityInterface): string {
    if (!isMergeOrBenchmarkEvent(this.event)) {
      return `${activity?.type || 'Swimming'}`.trim();
    }

    const name = `${activity?.creator?.name || ''}`.trim();
    const swInfo = `${activity?.creator?.swInfo || ''}`.trim();
    const label = swInfo ? `${name} ${swInfo}` : name;
    return label || `${activity?.type || 'Swimming'}`.trim();
  }

  private formatDuration(swimLength: AppSwimLength): string {
    const duration = swimLength.timerTime ?? swimLength.elapsedTime;
    if (duration === null) {
      return '';
    }

    return duration.getDisplayValue(false, true, true);
  }

  private formatDistance(distance: AppSwimLength['distance']): string {
    return distance === null ? '' : this.formatUnitAwareStat(distance);
  }

  private formatEnergy(calories: AppSwimLength['calories']): string {
    return calories === null ? '' : this.formatUnitAwareStat(calories);
  }

  private formatSwimPace(avgSpeed: AppSwimLength['avgSpeed']): string {
    const speed = avgSpeed?.getValue();
    if (typeof speed !== 'number' || speed <= 0) {
      return '';
    }

    return this.formatUnitAwareStat(new DataSwimPace(avgSpeed.getValue(DataSwimPace.type) as number));
  }

  private formatCadence(cadence: AppSwimLength['avgCadence']): string {
    if (cadence === null) {
      return '';
    }

    return `${cadence.getDisplayValue()} spm`;
  }

  private formatHeartRate(heartRate: AppSwimLength['avgHeartRate']): string {
    if (heartRate === null) {
      return '';
    }

    return this.formatUnitAwareStat(heartRate);
  }

  private formatDecimal(value: number | null): string {
    if (value === null) {
      return '';
    }

    return Number.isInteger(value) ? `${value}` : value.toFixed(1);
  }

  private formatOptionalInteger(value: number | null): string {
    return value === null ? '' : `${Math.round(value)}`;
  }

  private formatLabel(value: string | null): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, match => match.toUpperCase());
  }

  private formatUnitAwareStat(stat: DataInterface): string {
    const preferredStat = this.getUnitAwareStat(stat);
    const value = this.getDisplayValueSafe(preferredStat);
    if (!value || value === '[object Object]') {
      return '';
    }

    const unit = this.getDisplayUnitSafe(preferredStat);
    return `${value}${unit ? ` ${unit}` : ''}`.trim();
  }

  private getUnitAwareStat(stat: DataInterface): DataInterface {
    try {
      const convertedStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.unitSettings);
      return convertedStats?.[0] ?? stat;
    } catch {
      return stat;
    }
  }

  private getDisplayValueSafe(stat: DataInterface): string {
    try {
      const displayValue = stat.getDisplayValue();
      return displayValue === null || displayValue === undefined
        ? ''
        : `${displayValue}`.trim();
    } catch {
      return '';
    }
  }

  private getDisplayUnitSafe(stat: DataInterface): string {
    try {
      const displayUnit = stat.getDisplayUnit();
      return displayUnit === null || displayUnit === undefined
        ? ''
        : `${displayUnit}`.trim();
    } catch {
      return '';
    }
  }

  private buildColumns(rows: SwimLengthTableRow[]): SwimLengthTableColumn[] {
    return this.calculateColumnNames(rows).map(name => ({
      name,
      sticky: name === '#',
    }));
  }

  private calculateColumnNames(rows: SwimLengthTableRow[]): string[] {
    return this.getColumnsToDisplay().filter((column) => {
      if (column === '#') {
        return true;
      }

      return rows.some(row => this.hasRenderableCellValue(row[column as keyof SwimLengthTableRow]));
    });
  }

  private hasRenderableCellValue(value: unknown): boolean {
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return !!value;
  }

  private getColumnsToDisplay(): string[] {
    return [
      '#',
      'Lap',
      'Duration',
      'Distance',
      'Type',
      'Stroke',
      'Strokes',
      'Swim Pace',
      'Average Cadence',
      'Average Heart Rate',
      'SWOLF',
      'Energy',
    ];
  }
}
