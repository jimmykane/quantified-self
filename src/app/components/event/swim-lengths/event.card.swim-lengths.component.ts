import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import {
  ActivityInterface,
  convertSpeedToSwimPace,
  DataCadence,
  DataDuration,
  DataEnergy,
  DataHeartRate,
  DataInterface,
  DataSwimPace,
  DataSwimDistance,
  DynamicDataLoader,
  EventInterface,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { AppSwimLength, getActivitySwimLengths } from '../../../helpers/event-swim-length.helper';
import { isMergeOrBenchmarkEvent } from '../../../helpers/event-visibility.helper';

interface SwimLengthTableRow {
  '#': number;
  Lap: string;
  Split: string;
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
  numeric: boolean;
}

interface SwimLengthRowView {
  swimLength: AppSwimLength;
  row: SwimLengthTableRow;
}

interface SwimLengthGroupView {
  key: string;
  label: string;
  summaryRow: SwimLengthTableRow;
  restDuration: string;
  rows: SwimLengthTableRow[];
  columns: SwimLengthTableColumn[];
  columnNames: string[];
  expanded: boolean;
}

interface SwimLengthActivityView {
  key: string;
  activity: ActivityInterface;
  label: string;
  groups: SwimLengthGroupView[];
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
      const rowViews = this.generateSwimLengthRowViews(activity);
      if (!rowViews.length) {
        return;
      }

      const key = this.buildActivityKey(activity, index);
      this.activitiesWithSwimLengths.push(activity);
      pendingViews.push({
        key,
        activity,
        baseLabel: this.resolveActivityLabel(activity),
        groups: this.buildSwimLengthGroups(key, rowViews),
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

  private generateSwimLengthRowViews(activity: ActivityInterface): SwimLengthRowView[] {
    return getActivitySwimLengths(activity).map((swimLength) => ({
      swimLength,
      row: this.buildSwimLengthRow(swimLength),
    }));
  }

  private buildSwimLengthRow(swimLength: AppSwimLength): SwimLengthTableRow {
    return {
      '#': swimLength.index,
      Lap: this.formatOptionalInteger(swimLength.lapIndex),
      Split: '',
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
    };
  }

  private buildSwimLengthGroups(activityKey: string, rowViews: SwimLengthRowView[]): SwimLengthGroupView[] {
    const groupedRows: SwimLengthRowView[][] = [];
    let currentGroup: SwimLengthRowView[] = [];

    rowViews.forEach((rowView) => {
      currentGroup.push(rowView);

      if (this.isIdleOrRestSwimLength(rowView.swimLength)) {
        groupedRows.push(currentGroup);
        currentGroup = [];
      }
    });

    if (currentGroup.length > 0) {
      groupedRows.push(currentGroup);
    }

    return groupedRows.map((groupRows, index) => this.buildSwimLengthGroupView(activityKey, index, groupRows));
  }

  private buildSwimLengthGroupView(
    activityKey: string,
    index: number,
    rowViews: SwimLengthRowView[],
  ): SwimLengthGroupView {
    const rows = this.buildGroupRows(rowViews);
    const firstIndex = rowViews[0]?.swimLength.index ?? index + 1;
    const lastIndex = rowViews[rowViews.length - 1]?.swimLength.index ?? firstIndex;
    const columns = this.buildColumns(rows);

    return {
      key: `${activityKey}-group-${index + 1}-${firstIndex}-${lastIndex}`,
      label: firstIndex === lastIndex ? `Length ${firstIndex}` : `Lengths ${firstIndex}-${lastIndex}`,
      summaryRow: this.buildGroupSummaryRow(rowViews),
      restDuration: this.formatGroupRestDuration(rowViews),
      rows,
      columns,
      columnNames: columns.map(column => column.name),
      expanded: false,
    };
  }

  private buildGroupRows(rowViews: SwimLengthRowView[]): SwimLengthTableRow[] {
    let activeSplitIndex = 0;
    let cumulativeDistance = 0;

    return rowViews.map((rowView) => {
      const row = { ...rowView.row };
      const swimLength = rowView.swimLength;

      if (this.isIdleOrRestSwimLength(swimLength)) {
        row.Split = 'Rest';
        return row;
      }

      activeSplitIndex++;
      const splitDistance = this.getSwimLengthSplitDistance(swimLength);
      if (splitDistance !== null) {
        cumulativeDistance += splitDistance;
        row.Split = this.formatSwimDistanceValue(cumulativeDistance);
        return row;
      }

      row.Split = this.formatOptionalInteger(activeSplitIndex);
      return row;
    });
  }

  private buildGroupSummaryRow(rowViews: SwimLengthRowView[]): SwimLengthTableRow {
    const swimLengths = rowViews.map(rowView => rowView.swimLength);
    const firstIndex = swimLengths[0]?.index ?? 0;
    const lastSwimLength = swimLengths[swimLengths.length - 1];
    const totalDuration = this.sumDataValues(swimLengths, swimLength => swimLength.timerTime ?? swimLength.elapsedTime);
    const totalDistance = this.sumDataValues(swimLengths, swimLength => swimLength.distance);
    const totalEnergy = this.sumDataValues(swimLengths, swimLength => swimLength.calories);
    const totalStrokes = this.sumNumericValues(swimLengths, swimLength => swimLength.strokes);
    const avgCadence = this.averageDataValues(swimLengths, swimLength => swimLength.avgCadence);
    const avgHeartRate = this.averageDataValues(swimLengths, swimLength => swimLength.avgHeartRate);
    const avgSwolf = this.averageNumericValues(swimLengths, swimLength => swimLength.swolf);

    return {
      '#': firstIndex,
      Lap: this.formatLapRange(swimLengths),
      Split: '',
      Duration: totalDuration === null ? '' : new DataDuration(totalDuration).getDisplayValue(false, true, true),
      Distance: this.formatSwimDistanceValue(totalDistance),
      Type: this.isIdleOrRestSwimLength(lastSwimLength) ? 'Set + Rest' : 'Set',
      Stroke: this.getGroupStrokeLabel(swimLengths),
      Strokes: this.formatOptionalInteger(totalStrokes),
      'Swim Pace': this.formatGroupSwimPace(totalDuration, totalDistance),
      'Average Cadence': avgCadence === null ? '' : this.formatCadence(new DataCadence(avgCadence)),
      'Average Heart Rate': avgHeartRate === null ? '' : this.formatHeartRate(new DataHeartRate(avgHeartRate)),
      SWOLF: this.formatDecimal(avgSwolf),
      Energy: totalEnergy === null ? '' : this.formatUnitAwareStat(new DataEnergy(totalEnergy)),
    };
  }

  private formatGroupRestDuration(rowViews: SwimLengthRowView[]): string {
    const restSwimLengths = rowViews
      .map(rowView => rowView.swimLength)
      .filter(swimLength => this.isIdleOrRestSwimLength(swimLength));
    const restDuration = this.sumDataValues(restSwimLengths, swimLength => swimLength.timerTime ?? swimLength.elapsedTime);

    return restDuration === null ? '' : new DataDuration(restDuration).getDisplayValue(false, true, true);
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
    return this.formatSwimDistanceValue(this.getFiniteDataValue(distance));
  }

  private formatSwimDistanceValue(distance: number | null): string {
    return distance === null ? '' : this.formatUnitAwareStat(new DataSwimDistance(distance));
  }

  private formatEnergy(calories: AppSwimLength['calories']): string {
    return calories === null ? '' : this.formatUnitAwareStat(calories);
  }

  private formatSwimPace(avgSpeed: AppSwimLength['avgSpeed']): string {
    const speed = avgSpeed?.getValue();
    if (typeof speed !== 'number' || speed <= 0) {
      return '';
    }

    return this.formatUnitAwareStat(new DataSwimPace(convertSpeedToSwimPace(speed)));
  }

  private formatGroupSwimPace(totalDuration: number | null, totalDistance: number | null): string {
    if (totalDuration === null || totalDistance === null || totalDuration <= 0 || totalDistance <= 0) {
      return '';
    }

    return this.formatUnitAwareStat(new DataSwimPace(convertSpeedToSwimPace(totalDistance / totalDuration)));
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

  private getSwimLengthSplitDistance(swimLength: AppSwimLength): number | null {
    return this.getFiniteDataValue(swimLength.distance) ?? this.getFiniteDataValue(swimLength.poolLength);
  }

  private formatLapRange(swimLengths: AppSwimLength[]): string {
    const lapIndexes = swimLengths
      .map(swimLength => swimLength.lapIndex)
      .filter((lapIndex): lapIndex is number => typeof lapIndex === 'number' && Number.isFinite(lapIndex));

    if (lapIndexes.length === 0) {
      return '';
    }

    const firstLap = lapIndexes[0];
    const lastLap = lapIndexes[lapIndexes.length - 1];
    return firstLap === lastLap
      ? this.formatOptionalInteger(firstLap)
      : `${this.formatOptionalInteger(firstLap)}-${this.formatOptionalInteger(lastLap)}`;
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

  private getGroupStrokeLabel(swimLengths: AppSwimLength[]): string {
    const activeStrokes = swimLengths
      .filter(swimLength => !this.isIdleOrRestSwimLength(swimLength))
      .map(swimLength => swimLength.stroke)
      .filter((stroke): stroke is string => !!stroke && stroke.trim().length > 0);

    const strokeLabels = new Map<string, string>();
    activeStrokes.forEach((stroke) => {
      const normalizedStroke = stroke.trim().toLowerCase();
      if (!strokeLabels.has(normalizedStroke)) {
        strokeLabels.set(normalizedStroke, this.formatLabel(stroke));
      }
    });

    if (strokeLabels.size === 0) {
      return '';
    }

    if (strokeLabels.size === 1) {
      return [...strokeLabels.values()][0];
    }

    return 'Mixed';
  }

  private isIdleOrRestSwimLength(swimLength: AppSwimLength | null | undefined): boolean {
    const normalizedType = `${swimLength?.type || ''}`.trim().toLowerCase();
    return normalizedType === 'idle' || normalizedType === 'rest';
  }

  private sumDataValues(
    swimLengths: AppSwimLength[],
    getStat: (swimLength: AppSwimLength) => DataInterface | null,
  ): number | null {
    return this.sumNumericValues(swimLengths, swimLength => this.getFiniteDataValue(getStat(swimLength)));
  }

  private averageDataValues(
    swimLengths: AppSwimLength[],
    getStat: (swimLength: AppSwimLength) => DataInterface | null,
  ): number | null {
    return this.averageNumericValues(swimLengths, swimLength => this.getFiniteDataValue(getStat(swimLength)));
  }

  private sumNumericValues(
    swimLengths: AppSwimLength[],
    getValue: (swimLength: AppSwimLength) => number | null,
  ): number | null {
    let total = 0;
    let count = 0;

    swimLengths.forEach((swimLength) => {
      const value = getValue(swimLength);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return;
      }

      total += value;
      count++;
    });

    return count > 0 ? total : null;
  }

  private averageNumericValues(
    swimLengths: AppSwimLength[],
    getValue: (swimLength: AppSwimLength) => number | null,
  ): number | null {
    const total = this.sumNumericValues(swimLengths, getValue);
    if (total === null) {
      return null;
    }

    const count = swimLengths.filter((swimLength) => {
      const value = getValue(swimLength);
      return typeof value === 'number' && Number.isFinite(value);
    }).length;

    return count > 0 ? total / count : null;
  }

  private getFiniteDataValue(stat: DataInterface | null): number | null {
    try {
      const value = stat?.getValue();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  private buildColumns(rows: SwimLengthTableRow[]): SwimLengthTableColumn[] {
    return this.calculateColumnNames(rows).map(name => ({
      name,
      sticky: name === '#',
      numeric: this.isNumericColumn(name),
    }));
  }

  private isNumericColumn(columnName: string): boolean {
    return columnName !== 'Type' && columnName !== 'Stroke';
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
      'Split',
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
