import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { Sort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import {
  ActivityInterface,
  DataDuration,
  DataInterface,
  DataJumpEvent,
  DynamicDataLoader,
  EventInterface,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { isMergeOrBenchmarkEvent } from '../../../helpers/event-visibility.helper';

type JumpTableColumn =
  | '#'
  | 'At'
  | 'Jump Distance'
  | 'Jump Height'
  | 'Jump Hang Time'
  | 'Jump Speed'
  | 'Jump Rotations'
  | 'Jump Score';

interface JumpTableRow {
  '#': number;
  At: string;
  'Jump Distance': string;
  'Jump Height': string;
  'Jump Hang Time': string;
  'Jump Speed': string;
  'Jump Rotations': string;
  'Jump Score': string;
  sortValues: Record<JumpTableColumn, number | null>;
}

interface JumpActivityView {
  key: string;
  activity: ActivityInterface;
  label: string;
  dataSource: MatTableDataSource<JumpTableRow>;
  columns: string[];
}

@Component({
  selector: 'app-event-card-jumps',
  templateUrl: './event.card.jumps.component.html',
  styleUrls: ['./event.card.jumps.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventCardJumpsComponent implements OnChanges {
  @Input() event!: EventInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() unitSettings!: UserUnitSettingsInterface;

  public activitiesWithJumps: ActivityInterface[] = [];
  public jumpActivityViews: JumpActivityView[] = [];

  public dataSourcesMap = new Map<string, MatTableDataSource<JumpTableRow>>();
  public columnsMap = new Map<string, string[]>();

  private activityKeys = new WeakMap<ActivityInterface, string>();

  constructor(private changeDetectorRef: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.updateData();
  }

  getDataSource(activity: ActivityInterface): MatTableDataSource<JumpTableRow> | undefined {
    return this.dataSourcesMap.get(this.getKey(activity));
  }

  getColumns(activity: ActivityInterface): string[] {
    return this.columnsMap.get(this.getKey(activity)) || [];
  }

  getActivityTabLabel(activity: ActivityInterface, index: number): string {
    const baseLabel = this.resolveActivityLabel(activity);
    if (this.activitiesWithJumps.length <= 1) {
      return baseLabel;
    }

    return `${baseLabel} ${index + 1}`;
  }

  isSticky(column: string): boolean {
    return column === '#';
  }

  public sortRows(dataSource: MatTableDataSource<JumpTableRow>, sort: Sort): void {
    const column = sort.active as JumpTableColumn;
    if (!sort.direction || !this.isJumpTableColumn(column)) {
      return;
    }

    dataSource.data = [...dataSource.data].sort((left, right) =>
      this.compareRows(left, right, column, sort.direction)
    );
  }

  private updateData(): void {
    this.dataSourcesMap.clear();
    this.columnsMap.clear();
    this.activityKeys = new WeakMap<ActivityInterface, string>();
    this.activitiesWithJumps = [];
    this.jumpActivityViews = [];

    if (!Array.isArray(this.selectedActivities) || this.selectedActivities.length === 0) {
      this.changeDetectorRef.markForCheck();
      return;
    }

    const views: JumpActivityView[] = [];
    this.selectedActivities.forEach((activity, index) => {
      const rows = this.generateJumpData(activity);
      if (!rows.length) {
        return;
      }

      const key = this.buildActivityKey(activity, index);
      this.activityKeys.set(activity, key);
      this.activitiesWithJumps.push(activity);

      const dataSource = new MatTableDataSource(rows);
      const columns = this.calculateColumns(rows);
      this.dataSourcesMap.set(key, dataSource);
      this.columnsMap.set(key, columns);
      views.push({
        key,
        activity,
        label: '',
        dataSource,
        columns,
      });
    });

    this.jumpActivityViews = views.map((view, index) => ({
      ...view,
      label: this.getActivityTabLabel(view.activity, index),
    }));
    this.changeDetectorRef.markForCheck();
  }

  private buildActivityKey(activity: ActivityInterface, index: number): string {
    const activityID = `${activity?.getID?.() || ''}`.trim() || `activity-${index + 1}`;
    return `${activityID}-${index}`;
  }

  private getKey(activity: ActivityInterface): string {
    return this.activityKeys.get(activity) || '';
  }

  private generateJumpData(activity: ActivityInterface): JumpTableRow[] {
    const allEvents = (activity?.getAllEvents?.() || []);
    const jumpEvents = allEvents.filter((event) => this.isJumpEvent(event));

    return jumpEvents.reduce<JumpTableRow[]>((rows, event, index) => {
      const jumpData = this.resolveJumpData(event);
      if (!jumpData) {
        return rows;
      }

      rows.push({
        '#': index + 1,
        At: this.formatJumpAt(event),
        'Jump Distance': this.formatUnitAwareStat(jumpData.distance),
        'Jump Height': this.formatUnitAwareStat(jumpData.height),
        'Jump Hang Time': this.formatHangTime(jumpData.hang_time),
        'Jump Speed': this.formatUnitAwareStat(jumpData.speed),
        'Jump Rotations': this.formatUnitAwareStat(jumpData.rotations),
        'Jump Score': this.formatUnitAwareStat(jumpData.score),
        sortValues: {
          '#': index + 1,
          At: this.toSortableTimestamp(event),
          'Jump Distance': this.getSortableStatValue(jumpData.distance),
          'Jump Height': this.getSortableStatValue(jumpData.height),
          'Jump Hang Time': this.getSortableStatValue(jumpData.hang_time),
          'Jump Speed': this.getSortableStatValue(jumpData.speed),
          'Jump Rotations': this.getSortableStatValue(jumpData.rotations),
          'Jump Score': this.getSortableStatValue(jumpData.score),
        },
      });

      return rows;
    }, []);
  }

  private resolveActivityLabel(activity: ActivityInterface): string {
    if (!isMergeOrBenchmarkEvent(this.event)) {
      return `${activity?.type || 'Activity'}`.trim();
    }

    const name = `${activity?.creator?.name || ''}`.trim();
    const swInfo = `${activity?.creator?.swInfo || ''}`.trim();
    const label = swInfo ? `${name} ${swInfo}` : name;
    return label || `${activity?.type || 'Activity'}`.trim();
  }

  private isJumpEvent(event: unknown): boolean {
    if (event instanceof DataJumpEvent) {
      return true;
    }

    if (!event || typeof event !== 'object' || !('jumpData' in (event as Record<string, unknown>))) {
      return false;
    }

    const jumpData = (event as { jumpData?: unknown }).jumpData;
    return !!(jumpData && typeof jumpData === 'object');
  }

  private resolveJumpData(event: unknown): any | null {
    if (event instanceof DataJumpEvent) {
      return event.jumpData;
    }

    if (!event || typeof event !== 'object') {
      return null;
    }

    const jumpData = (event as { jumpData?: unknown }).jumpData;
    return jumpData && typeof jumpData === 'object' ? jumpData : null;
  }

  private formatJumpAt(event: unknown): string {
    const timestamp = this.resolveNumericTimestamp(event);
    if (!Number.isFinite(timestamp)) {
      return '';
    }

    if (timestamp >= 1e12) {
      return new Date(timestamp).toLocaleString();
    }

    if (timestamp >= 1e9) {
      return new Date(timestamp * 1000).toLocaleString();
    }

    if (timestamp < 0) {
      return `${timestamp}`;
    }

    try {
      return new DataDuration(timestamp).getDisplayValue(false, true, true);
    } catch {
      return `${timestamp}`;
    }
  }

  private resolveNumericTimestamp(event: unknown): number {
    if (!event || typeof event !== 'object') {
      return Number.NaN;
    }

    const rawTimestamp = (event as { timestamp?: unknown }).timestamp;
    if (typeof rawTimestamp === 'number') {
      return rawTimestamp;
    }

    if (typeof rawTimestamp === 'string' && rawTimestamp.trim() !== '') {
      const parsed = Number(rawTimestamp);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    }

    return Number.NaN;
  }

  private toSortableTimestamp(event: unknown): number | null {
    const timestamp = this.resolveNumericTimestamp(event);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private formatHangTime(stat: DataInterface | null | undefined): string {
    if (!stat) {
      return '';
    }

    try {
      return `${(stat as any).getDisplayValue(false, true, true)}`.trim();
    } catch {
      return this.formatUnitAwareStat(stat);
    }
  }

  private formatUnitAwareStat(stat: DataInterface | null | undefined): string {
    if (!stat) {
      return '';
    }

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

  private getSortableStatValue(stat: DataInterface | null | undefined): number | null {
    if (!stat) {
      return null;
    }

    const preferredStat = this.getUnitAwareStat(stat);
    try {
      const rawValue: unknown = preferredStat.getValue();
      const numericValue = typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string' ? Number(rawValue) : Number.NaN;
      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    } catch {
      // Fall back to the formatted number for providers that do not expose getValue().
    }

    const displayValue = this.getDisplayValueSafe(preferredStat).replace(',', '.');
    const parsedValue = Number.parseFloat(displayValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  private compareRows(
    left: JumpTableRow,
    right: JumpTableRow,
    column: JumpTableColumn,
    direction: Sort['direction'],
  ): number {
    const leftValue = left.sortValues[column];
    const rightValue = right.sortValues[column];
    if (leftValue === null && rightValue === null) {
      return left['#'] - right['#'];
    }
    if (leftValue === null) {
      return 1;
    }
    if (rightValue === null) {
      return -1;
    }

    const valueComparison = leftValue - rightValue;
    if (valueComparison === 0) {
      return left['#'] - right['#'];
    }

    return direction === 'asc' ? valueComparison : -valueComparison;
  }

  private calculateColumns(rows: JumpTableRow[]): string[] {
    const columns = this.getColumnsToDisplay();
    return columns.filter((column) => {
      if (column === '#') {
        return true;
      }

      return rows.some((row) => this.hasRenderableCellValue(row[column as keyof JumpTableRow]));
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
      'At',
      'Jump Distance',
      'Jump Height',
      'Jump Hang Time',
      'Jump Speed',
      'Jump Rotations',
      'Jump Score',
    ];
  }

  private isJumpTableColumn(column: string): column is JumpTableColumn {
    return this.getColumnsToDisplay().includes(column);
  }
}
