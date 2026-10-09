import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, inject } from '@angular/core';
import {
  ActivityInterface,
  convertSpeedToSwimPace,
  DataStrokeRate,
  DataDuration,
  DataEnergy,
  DataHeartRate,
  DataInterface,
  DataSwimPace,
  DynamicDataLoader,
  EventInterface,
  LapInterface,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import {
  AppSwimLength, getActivitySwimLengths, getSwimLapLengths, getSwimStrokeLabel, isRestSwimLength,
} from '../../../helpers/event-swim-length.helper';
import { isMergeOrBenchmarkEvent } from '../../../helpers/event-visibility.helper';
import { createSwimDistanceDisplayStat, resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { getActiveSwimLengthCadence, getNormalizedSwolf, getSwimLengthDistance, getSwimLengthDuration, getSwolfColumnLabel, sumSwimValues } from '../../../helpers/event-swim-analytics.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';

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
  'Average Stroke Rate': string;
  'Average Heart Rate': string;
  SWOLF: string;
  'Normalized SWOLF': string;
  isRest?: boolean;
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
  activeDuration: string;
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

  @Input() lap: LapInterface | null = null;
  public lapLengthTable: Pick<SwimLengthGroupView, 'rows' | 'columns' | 'columnNames'> | null = null;
  public swolfColumnLabel = '';

  public activitiesWithSwimLengths: ActivityInterface[] = [];
  public swimLengthViews: SwimLengthActivityView[] = [];
  private readonly hapticsService = inject(AppHapticsService);

  constructor(private changeDetectorRef: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.updateData();
  }

  public onGroupHeaderKeydown(event: KeyboardEvent): void {
    if ((event.key !== 'Enter' && event.key !== ' ')
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    // Material toggles headers directly on Enter/Space, without generating a click.
    this.hapticsService.selection();
  }

  private updateData(): void {
    const expandedGroupKeys = new Set(this.swimLengthViews.flatMap(view => view.groups)
      .filter(group => group.expanded).map(group => group.key));
    this.swolfColumnLabel = getSwolfColumnLabel(this.unitSettings);
    this.lapLengthTable = null;
    this.activitiesWithSwimLengths = [];
    this.swimLengthViews = [];

    if (!Array.isArray(this.selectedActivities) || this.selectedActivities.length === 0) {
      this.changeDetectorRef.markForCheck();
      return;
    }

    if (this.lap) {
      const activity = this.selectedActivities[0];
      const rowViews = (getSwimLapLengths(activity).get(this.lap) || []).map(swimLength => ({
        swimLength, row: this.buildSwimLengthRow(swimLength),
      }));
      const rows = this.buildGroupRows(rowViews);
      const columns = this.buildColumns(rows);
      this.lapLengthTable = { rows, columns, columnNames: columns.map(column => column.name) };
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
        groups: view.groups.map(group => ({ ...group, expanded: expandedGroupKeys.has(group.key) })),
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
      isRest: isRestSwimLength(swimLength),
      Lap: this.formatOptionalInteger(swimLength.lapIndex),
      Split: '',
      Duration: this.formatDuration(swimLength),
      Distance: this.formatSwimDistanceValue(isRestSwimLength(swimLength)
        ? this.getFiniteDataValue(swimLength.distance) : getSwimLengthDistance(swimLength)),
      Type: this.formatLabel(swimLength.type),
      Stroke: this.formatLabel(swimLength.stroke),
      Strokes: this.formatOptionalInteger(swimLength.strokes),
      'Swim Pace': this.formatSwimPace(swimLength.avgSpeed)
        || (!isRestSwimLength(swimLength) ? this.formatGroupSwimPace(getSwimLengthDuration(swimLength), getSwimLengthDistance(swimLength)) : ''),
      'Average Stroke Rate': this.formatStrokeRate(swimLength.avgCadence),
      'Average Heart Rate': this.formatHeartRate(swimLength.avgHeartRate),
      SWOLF: this.formatDecimal(swimLength.swolf),
      'Normalized SWOLF': isRestSwimLength(swimLength) ? '' : this.formatOptionalStat(getNormalizedSwolf(
        getSwimLengthDuration(swimLength), getSwimLengthDistance(swimLength), swimLength.strokes, this.unitSettings,
      )),
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
      activeDuration: this.formatDurationValue(this.sumDataValues(
        rowViews.map(rowView => rowView.swimLength).filter(swimLength => !this.isIdleOrRestSwimLength(swimLength)),
        swimLength => swimLength.timerTime ?? swimLength.elapsedTime,
      )),
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
    const activeSwimLengths = swimLengths.filter(swimLength => !this.isIdleOrRestSwimLength(swimLength));
    const firstIndex = swimLengths[0]?.index ?? 0;
    const lastSwimLength = swimLengths[swimLengths.length - 1];
    const totalDuration = this.sumDataValues(swimLengths, swimLength => swimLength.timerTime ?? swimLength.elapsedTime);
    const totalDistance = this.sumNumericValues(swimLengths, swimLength => isRestSwimLength(swimLength)
      ? this.getFiniteDataValue(swimLength.distance) : getSwimLengthDistance(swimLength));
    const activeDuration = activeSwimLengths.every(length => getSwimLengthDuration(length) !== null)
      ? this.sumNumericValues(activeSwimLengths, getSwimLengthDuration) : null;
    const activeDistance = activeSwimLengths.every(length => getSwimLengthDistance(length) !== null)
      ? this.sumNumericValues(activeSwimLengths, getSwimLengthDistance) : null;
    const totalEnergy = this.sumDataValues(swimLengths, swimLength => swimLength.calories);
    const totalStrokes = activeSwimLengths.every(length => length.strokes !== null && length.strokes >= 0)
      ? this.sumNumericValues(activeSwimLengths, swimLength => swimLength.strokes) : null;
    const avgCadence = getActiveSwimLengthCadence(activeSwimLengths);
    const avgHeartRate = this.averageDataValues(activeSwimLengths, swimLength => swimLength.avgHeartRate);
    const avgSwolf = this.averageNumericValues(activeSwimLengths, swimLength => swimLength.swolf);

    return {
      '#': firstIndex,
      Lap: this.formatLapRange(swimLengths),
      Split: '',
      Duration: this.formatDurationValue(totalDuration),
      Distance: this.formatSwimDistanceValue(totalDistance),
      Type: activeSwimLengths.length === 0 ? 'Rest' : this.isIdleOrRestSwimLength(lastSwimLength) ? 'Set + Rest' : 'Set',
      Stroke: getSwimStrokeLabel(swimLengths),
      Strokes: this.formatOptionalInteger(totalStrokes),
      'Swim Pace': this.formatGroupSwimPace(activeDuration, activeDistance),
      'Average Stroke Rate': avgCadence === null ? '' : this.formatStrokeRate(new DataStrokeRate(avgCadence)),
      'Average Heart Rate': avgHeartRate === null ? '' : this.formatHeartRate(new DataHeartRate(avgHeartRate)),
      SWOLF: this.formatDecimal(avgSwolf),
      'Normalized SWOLF': this.formatOptionalStat(getNormalizedSwolf(activeDuration, activeDistance, totalStrokes, this.unitSettings)),
      Energy: totalEnergy === null ? '' : this.formatUnitAwareStat(new DataEnergy(totalEnergy)),
    };
  }

  private formatGroupRestDuration(rowViews: SwimLengthRowView[]): string {
    const restSwimLengths = rowViews
      .map(rowView => rowView.swimLength)
      .filter(swimLength => this.isIdleOrRestSwimLength(swimLength));
    const restDuration = this.sumDataValues(restSwimLengths, swimLength => swimLength.timerTime ?? swimLength.elapsedTime);

    return this.formatDurationValue(restDuration);
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
    return this.formatDurationValue(this.getFiniteDataValue(swimLength.timerTime ?? swimLength.elapsedTime));
  }

  private formatDurationValue(seconds: number | null): string {
    return seconds === null ? '' : resolveUnitAwareDisplayStat(new DataDuration(seconds), this.unitSettings, {
      durationMilliseconds: true,
    })?.text ?? '';
  }

  private formatSwimDistanceValue(distance: number | null): string {
    return distance === null ? '' : resolveUnitAwareDisplayStat(
      createSwimDistanceDisplayStat(distance, this.unitSettings), this.unitSettings,
    )?.text ?? '';
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

  private formatStrokeRate(strokeRate: AppSwimLength['avgCadence']): string {
    return strokeRate === null ? '' : this.formatUnitAwareStat(strokeRate);
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

  private formatOptionalStat(stat: DataInterface | null): string {
    return stat ? this.formatUnitAwareStat(stat) : '';
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

  private isIdleOrRestSwimLength(swimLength: AppSwimLength | null | undefined): boolean {
    return isRestSwimLength(swimLength);
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
    const values: number[] = [];

    swimLengths.forEach((swimLength) => {
      const value = getValue(swimLength);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return;
      }

      values.push(value);
    });

    return values.length > 0 ? sumSwimValues(values) : null;
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
      'Average Stroke Rate',
      'Average Heart Rate',
      'SWOLF',
      'Normalized SWOLF',
      'Energy',
    ];
  }
}
