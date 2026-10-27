import { getRejectedSwimTiming, SWIM_TIMING_UNAVAILABLE_REASON } from '@shared/swim-timing';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  Injector,
  OnChanges,
  OnDestroy,
  TemplateRef,
  ViewChild,
  afterNextRender,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatSelectionListChange } from '@angular/material/list';
import { DOCUMENT } from '@angular/common';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import {
  ActivityInterface,
  DataDistance,
  EventInterface,
  DataHeartRateAvg,
  DataHeartRateMax,
  LapInterface,
  LapTypes,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { getSwimIntervalActivity } from '../../../helpers/event-swim-interval.helper';
import { getNominalSwimDistanceDisplayContext } from '../../../helpers/event-swim-distance-display.helper';
import { DataTableAbstractDirective } from '../../data-table/data-table-abstract.directive';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { getVisibleEventLaps, getEventLapContextLabel, getEventLapTableGroups, normalizeEventLapType } from '../../../helpers/event-lap-type.helper';
import {
  EventLapMetricOption,
  EventLapMetricOptionGroup,
  EVENT_LAP_STROKE_COLUMN,
  formatEventLapMetric,
  getAverageEventLapMetrics,
  getAvailableEventLapMetricTypes,
  getEventLapMetricOptionGroups,
  getEventLapAdditionalMetricOptionGroups,
  getEventLapColumnPickerOptions,
  getEventLapSportFamilyPresentation,
  getEventLapMetricStat,
  getSelectedEventLapSummaryMetrics,
  getSelectedEventLapMetricTypes,
  normalizeEventDetailsSettings,
  moveEventLapMetricType,
  resolveEventLapSportFamily,
} from '../../../helpers/event-lap-table-columns.helper';
import {
  AppEventDetailsSettingsInterface,
  AppEventLapSportFamily,
} from '../../../models/app-user.interface';
import { getSwimLapLengths, getSwimLapStrokeLabels } from '../../../helpers/event-swim-length.helper';
import { getSwimRestBlockMetric, groupSwimRestLaps } from '../../../helpers/event-swim-rest-block.helper';
import { EVENT_LAP_SWOLF_COLUMN, SWIM_TABLE_HEADER_TOOLTIPS, getSwimLapAnalytics, getSwimLapDisplayMetric, getSwolfColumnLabel } from '../../../helpers/event-swim-analytics.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';

interface LapTableRow extends Record<string, unknown> {
  '#': string | number;
  isLapAverage?: boolean;
  isSelected?: boolean;
  isPartiallySelected?: boolean;
  members?: LapTableRow[];
  metricNotes?: Record<string, string>;
  isRest?: boolean;
  isFinalLap?: boolean;
  contextLabel?: string;
  timingExplanation?: string;
  hasLengths?: boolean;
  lengthsExpanded?: boolean;
  detailId?: string;
  lap?: LapInterface;
  selectionKey?: string;
}

interface LapColumnMenuGroup {
  family: AppEventLapSportFamily;
  label: string;
  selectedMetricTypes: string[];
  selectedMetrics: EventLapMetricOption[];
  metricAvailability: Record<string, LapMetricAvailability>;
  selectedUnavailableMetricCount: number;
  metricGroups: EventLapMetricOptionGroup[];
  availableMetricGroups: EventLapMetricOptionGroup[];
  filteredMetricGroups: EventLapMetricOptionGroup[];
  additionalMetricGroups: EventLapMetricOptionGroup[];
  availableAdditionalMetricGroups: EventLapMetricOptionGroup[];
  filteredAdditionalMetricGroups: EventLapMetricOptionGroup[];
  showAdditionalMetrics: boolean;
  selectedAdditionalMetricCount: number;
  recordedAdditionalMetricCount: number;
  additionalSearchMatchCount: number | null;
  searchTerm: string;
}

interface LapMetricAvailability {
  availableTableCount: number;
  tableCount: number;
  label: string | null;
}

interface LapTableView {
  key: string;
  activity: ActivityInterface;
  columnTooltips: Readonly<Record<string, string>>;
  rowNoun: 'interval' | 'lap';
  dataSource: MatTableDataSource<LapTableRow>;
  columns: string[];
  selection: SelectionModel<LapTableRow>;
  selectedCount: number;
  selectedSummary: Record<string, string>;
  selectedSummaryLabel: string;
  hasContextLabels: boolean;
  allLapRowsSelected: boolean;
  someLapRowsSelected: boolean;
}

interface LapTableGroup {
  lapType: LapTypes;
  tables: LapTableView[];
}

const LAP_TABLE_SELECTION_COLUMN = 'selection';

function filterLapMetricGroups(
  metricGroups: EventLapMetricOptionGroup[],
  searchTerm: string,
): EventLapMetricOptionGroup[] {
  const queryTokens = searchTerm.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (queryTokens.length === 0) {
    return metricGroups;
  }

  const matchesQuery = (value: string): boolean => {
    const normalizedValue = value.toLocaleLowerCase();
    return queryTokens.every((token) => normalizedValue.includes(token));
  };

  return metricGroups.reduce<EventLapMetricOptionGroup[]>((filteredGroups, metricGroup) => {
    const groupMatches = matchesQuery(metricGroup.label);
    const metrics = metricGroup.metrics.filter((metric) => groupMatches || matchesQuery(
      `${metric.label} ${metric.type}`,
    ));
    if (metrics.length > 0) {
      filteredGroups.push({ ...metricGroup, metrics });
    }
    return filteredGroups;
  }, []);
}

@Component({
  selector: 'app-event-card-laps',
  templateUrl: './event.card.laps.component.html',
  styleUrls: ['./event.card.laps.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardLapsComponent extends DataTableAbstractDirective implements OnChanges, OnDestroy {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Input() unitSettings: UserUnitSettingsInterface;
  @Input() canCustomize = false;

  public readonly swolfColumn = EVENT_LAP_SWOLF_COLUMN;
  public readonly maximumHeartRateType = DataHeartRateMax.type;
  public readonly hasRecordedLengths = (_index: number, row: LapTableRow): boolean => !!row.hasLengths || !!row.members?.length;
  public readonly isLapAverageRow = (_index: number, row: LapTableRow): boolean => !!row.isLapAverage;
  public readonly isLapDataRow = (_index: number, row: LapTableRow): boolean => !row.isLapAverage;
  public swolfColumnLabel = '';
  public hasSwimIntervals = false;
  public readonly showOriginalLaps = signal(false);
  private displayActivities: ActivityInterface[] = [];
  private displayEventActivities: ActivityInterface[] = [];
  private intervalActivities = new Set<ActivityInterface>();
  private readonly expandedLapKeys = new Set<string>();
  public availableLapTypes: LapTypes[] = [];

  public dataSourcesMap = new Map<string, MatTableDataSource<LapTableRow>>();
  public columnsMap = new Map<string, string[]>();
  public lapTableGroups: LapTableGroup[] = [];
  public lapColumnMenuGroups: LapColumnMenuGroup[] = [];
  public activeLapColumnMenuGroup: LapColumnMenuGroup | null = null;
  public hasMultipleEventActivities = false;
  public savingLapColumnSportFamilies = signal(new Set<AppEventLapSportFamily>());
  public lapColumnAnnouncement = signal('');
  @ViewChild('lapColumnsDialog') private lapColumnsDialog?: TemplateRef<unknown>;
  private lapColumnsDialogRef: MatDialogRef<unknown> | null = null;
  private destroyed = false;
  private readonly pendingLapColumnMetricTypes = new Map<AppEventLapSportFamily, string[]>();
  private eventDetailsSettings: AppEventDetailsSettingsInterface = normalizeEventDetailsSettings(null);
  private readonly userSettingsQuery = inject(AppUserSettingsQueryService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly hapticsService = inject(AppHapticsService);
  private readonly dialog = inject(MatDialog);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  constructor(protected changeDetectorRef: ChangeDetectorRef) {
    super(changeDetectorRef);
    effect(() => {
      const persistedSettings = this.userSettingsQuery.eventDetailsSettings();
      this.eventDetailsSettings = normalizeEventDetailsSettings({
        lapTableColumnsBySportFamily: {
          ...persistedSettings.lapTableColumnsBySportFamily,
          ...Object.fromEntries(this.pendingLapColumnMetricTypes),
        },
      });
      this.updateData();
    });
  }

  ngOnChanges() {
    this.hasMultipleEventActivities = (this.event?.getActivities?.() || []).length > 1;
    this.updateData();
    if (!this.canCustomize || this.lapColumnMenuGroups.length === 0) {
      this.lapColumnsDialogRef?.close('context-changed');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.lapColumnsDialogRef?.close();
  }

  public openLapColumnsDialog(): void {
    if (!this.canCustomize || !this.lapColumnsDialog || this.lapColumnsDialogRef || !this.lapColumnMenuGroups.length) {
      return;
    }
    this.lapColumnAnnouncement.set('');
    const dialogRef = this.dialog.open(this.lapColumnsDialog, {
      ariaLabel: 'Choose lap columns',
      width: '520px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100dvh - 24px)',
      autoFocus: 'first-heading',
      restoreFocus: true,
    });
    this.lapColumnsDialogRef = dialogRef;
    this.hapticsService.selection();
    dialogRef.afterClosed().subscribe(result => {
      if (this.lapColumnsDialogRef === dialogRef) {
        this.lapColumnsDialogRef = null;
      }
      if (!this.destroyed && result !== 'context-changed') this.hapticsService.selection();
    });
  }

  public setOriginalLaps(showOriginal: boolean): void {
    if (!this.hasSwimIntervals || this.showOriginalLaps() === showOriginal) return;
    this.showOriginalLaps.set(showOriginal);
    this.hapticsService.selection();
    this.updateData();
  }

  private updateData() {
    this.swolfColumnLabel = getSwolfColumnLabel(this.unitSettings);
    const selectedLapKeys = this.getSelectedLapKeys();
    this.dataSourcesMap.clear();
    this.columnsMap.clear();
    this.lapTableGroups = [];

    if (!this.selectedActivities) {
      this.hasSwimIntervals = false;
      this.availableLapTypes = [];
      this.lapColumnMenuGroups = [];
      this.changeDetectorRef.markForCheck();
      return;
    }

    const projections = new Map(this.selectedActivities.map(activity => [activity, getSwimIntervalActivity(activity)]));
    this.hasSwimIntervals = [...projections.values()].some(Boolean);
    if (!this.hasSwimIntervals) this.showOriginalLaps.set(false);
    this.intervalActivities = new Set(this.showOriginalLaps() ? [] : [...projections.values()].filter(Boolean));
    const displayActivity = (activity: ActivityInterface) => this.showOriginalLaps() ? activity : projections.get(activity) || activity;
    this.displayActivities = this.selectedActivities.map(displayActivity);
    this.displayEventActivities = (this.event?.getActivities?.() || this.selectedActivities).map(displayActivity);
    const lapTypesWithData = new Set<LapTypes>();
    const tablesByKey = new Map<string, LapTableView>();
    const groupsByActivity = new Map(this.displayActivities.map(activity => [activity,
      this.intervalActivities.has(activity) ? [{ lapType: LapTypes.Interval, laps: activity.getLaps() }]
        : getEventLapTableGroups(activity, this.displayEventActivities),
    ]));
    this.availableLapTypes = [...new Set(Array.from(groupsByActivity.values()).flatMap(groups => groups.map(group => group.lapType)))];

    this.displayActivities.forEach(activity => {
      groupsByActivity.get(activity)!.forEach(({ lapType, laps }) => {
        const data = this.generateLapData(activity, lapType, laps);
        const key = this.getKey(activity, lapType);

        if (data.length > 0) {
          lapTypesWithData.add(lapType);
          const dataSource = new MatTableDataSource(data);
          this.dataSourcesMap.set(key, dataSource);
          const columns = this.calculateColumns(dataSource, activity.type);
          this.columnsMap.set(key, columns);
          const selection = new SelectionModel<LapTableRow>(true);
          const selectableRows = this.getSelectableRows(data);
          selection.select(...selectableRows.filter((row) => selectedLapKeys.has(row.selectionKey || '')));
          const table: LapTableView = {
            key,
            activity,
            columnTooltips: resolveEventLapSportFamily(activity.type) !== 'swimming' ? {}
              : this.showOriginalLaps() && projections.get(activity) ? { ...SWIM_TABLE_HEADER_TOOLTIPS,
                'Total strokes': 'Stroke count for this source lap. Use Intervals for complete set totals.',
              } : SWIM_TABLE_HEADER_TOOLTIPS,
            rowNoun: this.intervalActivities.has(activity) ? 'interval' : 'lap',
            dataSource,
            columns,
            selection,
            selectedCount: 0,
            selectedSummary: {},
            selectedSummaryLabel: '',
            hasContextLabels: data.some(row => !!row.contextLabel),
            allLapRowsSelected: false,
            someLapRowsSelected: false,
          };
          this.refreshSelectedSummary(table);
          tablesByKey.set(key, table);
        }
      });
    });

    this.availableLapTypes = this.availableLapTypes.filter(lapType => lapTypesWithData.has(lapType));
    this.lapTableGroups = this.availableLapTypes.map((lapType) => ({
      lapType,
      tables: this.displayActivities
        .map((activity): LapTableView | null => {
          const key = this.getKey(activity, lapType);
          const dataSource = this.dataSourcesMap.get(key);
          const columns = this.columnsMap.get(key);
          if (!dataSource || !columns) {
            return null;
          }
          return tablesByKey.get(key) || null;
        })
        .filter((table): table is LapTableView => !!table),
    })).filter((group) => group.tables.length > 0);
    this.updateLapColumnMenuGroups();
    const currentLapKeys = new Set(this.lapTableGroups.flatMap(group => group.tables)
      .flatMap(table => table.dataSource.data.flatMap(row => [row, ...(row.members || [])])).map(row => row.selectionKey));
    this.expandedLapKeys.forEach(key => {
      if (!currentLapKeys.has(key)) {
        this.expandedLapKeys.delete(key);
      }
    });
    this.changeDetectorRef.markForCheck();
  }

  private getKey(activity: ActivityInterface, lapType: LapTypes): string {
    return `${activity.getID()}-${this.intervalActivities.has(activity) ? 'intervals-' : ''}${lapType}`;
  }

  private generateLapData(activity: ActivityInterface, lapType: LapTypes, laps: readonly LapInterface[]): LapTableRow[] {
    const metricTypes = this.getColumnsToDisplay(activity.type).filter((column) => column !== '#');
    const swimming = resolveEventLapSportFamily(activity.type) === 'swimming';
    const sourceIndexes = new Map((activity.getLaps?.() || []).map((lap, index) => [lap, index]));
    const analytics = swimming ? getSwimLapAnalytics(activity, this.unitSettings) : new Map();
    const nominalDistanceDisplay = swimming ? getNominalSwimDistanceDisplayContext(activity) : null;
    const lapStrokeLabels = metricTypes.includes(EVENT_LAP_STROKE_COLUMN) ? getSwimLapStrokeLabels(activity) : null;
    const lapRows = laps.reduce<LapTableRow[]>((lapDataArray, lap, index) => {
      const row: LapTableRow = {
        '#': index + 1,
      };
      const sourceIndex = sourceIndexes.get(lap) ?? index;
      const lapIdentity = `${Number.isFinite(lap.lapId) ? lap.lapId : 'index'}-${sourceIndex}`;
      // A final lap can move between display groups as more lap types hydrate.
      // Selection/disclosure identity follows its original type, never its tab.
      const selectionKey = `${this.getKey(activity, lap.type)}-${lapIdentity}`;
      const contextLabel = getEventLapContextLabel(activity, lap, this.displayEventActivities);
      const swim = contextLabel ? undefined : analytics.get(lap);
      Object.defineProperties(row, {
        contextLabel: { value: contextLabel, enumerable: false },
        timingExplanation: { value: getRejectedSwimTiming(lap) ? SWIM_TIMING_UNAVAILABLE_REASON : undefined, enumerable: false },
        isRest: { value: swim?.isRest || false, enumerable: false },
        isFinalLap: { value: normalizeEventLapType(lap.type) === LapTypes.session_end
          && normalizeEventLapType(lapType) !== LapTypes.session_end, enumerable: false },
        hasLengths: { value: !!swim?.lengths.length, enumerable: false },
        lengthsExpanded: { value: this.expandedLapKeys.has(selectionKey), writable: true, enumerable: false },
        detailId: { value: `lap-lengths-${encodeURIComponent(selectionKey)}`, enumerable: false },
        isSelected: { value: false, writable: true, enumerable: false },
        lap: { value: lap, enumerable: false },
        selectionKey: {
          value: selectionKey,
          enumerable: false,
        },
      });

      metricTypes.forEach((metricType) => {
        row[metricType] = metricType === EVENT_LAP_STROKE_COLUMN ? (contextLabel ? '' : lapStrokeLabels?.get(lap) || '') : formatEventLapMetric(
          getSwimLapDisplayMetric(swim, metricType) === undefined
            ? getEventLapMetricStat(lap, metricType) : getSwimLapDisplayMetric(swim, metricType),
          metricType,
          this.unitSettings,
          contextLabel ? 'Other' : activity.type,
          !contextLabel && metricType === DataDistance.type ? nominalDistanceDisplay?.lapMeters.get(lap) : undefined,
        );
      });

      lapDataArray.push(row);
      return lapDataArray;
    }, []);

    const displayRows = swimming ? this.groupRestRows(activity, lapRows, metricTypes) : lapRows;
    if (laps.length < 2) {
      return displayRows;
    }
    const localLaps = laps.filter(lap => !getEventLapContextLabel(activity, lap, this.displayEventActivities));
    const averageMetrics = getAverageEventLapMetrics(localLaps, metricTypes, this.unitSettings, activity.type, activity,
      this.displayEventActivities);
    if (averageMetrics.length === 0) {
      return displayRows;
    }

    const averageRow: LapTableRow = {
      '#': 'Summary',
      isLapAverage: true,
    };
    Object.defineProperty(averageRow, 'metricNotes', { value: {
      [DataHeartRateMax.type]: 'Whole-session peak, including rest, from available session, lap and heart-rate sample values.',
      [DataHeartRateAvg.type]: swimming
        ? 'Mean of available active-lap average heart rates; excludes rest.'
        : 'Mean of available lap average heart rates.',
    } });
    averageMetrics.forEach(({ type, display }) => {
      averageRow[type] = display;
    });
    return [averageRow, ...displayRows];
  }

  private groupRestRows(activity: ActivityInterface, rows: LapTableRow[], metricTypes: string[]): LapTableRow[] {
    const rowsByLap = new Map(rows.map(row => [row.lap, row]));
    const rowOrder = new Map(rows.map((row, index) => [row, index]));
    return groupSwimRestLaps(activity.getLaps?.() || [], getSwimLapLengths(activity)).flatMap(laps => {
      const members = laps.map(lap => rowsByLap.get(lap)).filter((row): row is LapTableRow => !!row);
      if (members.length < 2) return members;
      const selectionKey = `rest-${members.map(row => row.selectionKey).join('_')}`;
      const row: LapTableRow = { '#': `${members[0]['#']}–${members[members.length - 1]['#']}` };
      const metricNotes: Record<string, string> = {};
      Object.defineProperties(row, {
        members: { value: members, enumerable: false },
        isRest: { value: true, enumerable: false },
        isSelected: { value: false, writable: true, enumerable: false },
        isPartiallySelected: { value: false, writable: true, enumerable: false },
        lengthsExpanded: { value: this.expandedLapKeys.has(selectionKey), writable: true, enumerable: false },
        detailId: { value: `lap-lengths-${encodeURIComponent(selectionKey)}`, enumerable: false },
        selectionKey: { value: selectionKey, enumerable: false },
        metricNotes: { value: metricNotes, enumerable: false },
      });
      metricTypes.forEach(type => {
        const metric = getSwimRestBlockMetric(laps, type);
        const display = formatEventLapMetric(metric?.stat, type, this.unitSettings, activity.type);
        row[type] = display && metric.availableCount < laps.length
          ? `${display} · ${metric.availableCount}/${laps.length} laps` : display;
        if (type === DataHeartRateAvg.type && metric) {
          metricNotes[type] = 'Estimate weighted by the recorded duration of each lap with heart-rate data.';
        }
      });
      return [row];
    }).sort((a, b) => rowOrder.get(a.members?.[0] || a)! - rowOrder.get(b.members?.[0] || b)!);
  }

  private getSelectableRows(rows: readonly LapTableRow[]): LapTableRow[] {
    return rows.filter(row => !row.isLapAverage).flatMap(row => row.members || [row]);
  }

  private calculateColumns(dataSource: MatTableDataSource<LapTableRow>, activityType: unknown): string[] {
    return [LAP_TABLE_SELECTION_COLUMN, '#',
      ...(dataSource.data.some(row => row.hasLengths || row.members?.length) ? ['lengths'] : []),
      ...this.getColumnsToDisplay(activityType).filter(column => column !== '#')].filter(column => {
      if (column === LAP_TABLE_SELECTION_COLUMN || column === '#' || column === 'lengths') {
        return true;
      }
      return dataSource.data.flatMap(row => [row, ...(row.members || [])]).some(row => {
        const cellValue = row[column as keyof LapTableRow];
        return (typeof cellValue === 'number' && Number.isFinite(cellValue))
          || (typeof cellValue === 'string' && cellValue.trim().length > 0);
      });
    });
  }

  getDataSource(activity: ActivityInterface, lapType: LapTypes): MatTableDataSource<LapTableRow> | undefined {
    return this.dataSourcesMap.get(this.getKey(activity, lapType));
  }

  getColumns(activity: ActivityInterface, lapType: LapTypes): string[] {
    return this.columnsMap.get(this.getKey(activity, lapType)) || [];
  }

  getColumnsToDisplay(activityType: unknown = 'Other'): string[] {
    const family = resolveEventLapSportFamily(activityType);
    return [
      '#',
      ...getSelectedEventLapMetricTypes(
        this.canCustomize ? this.eventDetailsSettings : undefined,
        family,
        [activityType],
      ),
    ];
  }

  isSticky(column: string): boolean {
    return column === LAP_TABLE_SELECTION_COLUMN || column === '#';
  }

  isStickyEnd(_column: string): boolean {
    return false;
  }

  public toggleLapLengths(row: LapTableRow): void {
    if ((!row.hasLengths && !row.members?.length) || !row.selectionKey) {
      return;
    }
    row.lengthsExpanded = !row.lengthsExpanded;
    if (row.lengthsExpanded) {
      this.expandedLapKeys.add(row.selectionKey);
    } else {
      this.expandedLapKeys.delete(row.selectionKey);
    }
    this.hapticsService.selection();
    this.changeDetectorRef.markForCheck();
  }

  public toggleLapSelection(table: LapTableView, row: LapTableRow): void {
    if (row.isLapAverage) {
      return;
    }
    const members = row.members || [row];
    if (members.every(member => table.selection.isSelected(member))) {
      table.selection.deselect(...members);
    } else {
      table.selection.select(...members);
    }
    this.hapticsService.selection();
    this.refreshSelectedSummary(table);
    this.changeDetectorRef.markForCheck();
  }

  public toggleAllLapSelections(table: LapTableView): void {
    const selectableRows = this.getSelectableRows(table.dataSource.data);
    if (selectableRows.length === 0) {
      return;
    }
    if (table.allLapRowsSelected) {
      table.selection.clear();
    } else {
      table.selection.select(...selectableRows);
    }
    this.hapticsService.selection();
    this.refreshSelectedSummary(table);
    this.changeDetectorRef.markForCheck();
  }

  public async onLapColumnSelectionChange(
    sportFamily: AppEventLapSportFamily,
    event: MatSelectionListChange,
  ): Promise<void> {
    if (!this.canCustomize || this.savingLapColumnSportFamilies().has(sportFamily)) {
      return;
    }

    const currentMetricTypes = getSelectedEventLapMetricTypes(
      this.eventDetailsSettings, sportFamily, this.getLapColumnFamilyActivityTypes(sportFamily),
    );
    const selectedMetricTypes = new Set(currentMetricTypes);
    event.options.forEach((option) => {
      if (typeof option.value !== 'string') {
        return;
      }
      if (option.selected) {
        selectedMetricTypes.add(option.value);
      } else {
        selectedMetricTypes.delete(option.value);
      }
    });
    const focused = this.getLapColumnPickerFocus();
    const metricType = event.options.find(option => option.selected)?.value;
    const save = this.saveLapColumnMetricTypes(sportFamily, Array.from(selectedMetricTypes));
    this.restoreLapColumnPickerFocus(sportFamily, focused, metricType);
    await save;
    this.restoreLapColumnPickerFocus(sportFamily, focused, metricType);
  }

  public async onLapColumnCheckedChange(
    sportFamily: AppEventLapSportFamily, metricType: string, checked: boolean,
  ): Promise<void> {
    const current = getSelectedEventLapMetricTypes(this.eventDetailsSettings, sportFamily);
    const focused = this.getLapColumnPickerFocus();
    const save = this.saveLapColumnMetricTypes(sportFamily, checked
      ? [...current, metricType] : current.filter(type => type !== metricType));
    this.restoreLapColumnPickerFocus(sportFamily, focused, metricType);
    await save;
    this.restoreLapColumnPickerFocus(sportFamily, focused, metricType);
  }

  public async moveLapColumn(
    sportFamily: AppEventLapSportFamily, metricType: string, direction: -1 | 1,
  ): Promise<void> {
    const focused = this.getLapColumnPickerFocus();
    const current = getSelectedEventLapMetricTypes(this.eventDetailsSettings, sportFamily);
    const next = moveEventLapMetricType(current, metricType, direction);
    const save = this.saveLapColumnMetricTypes(sportFamily, next);
    this.restoreLapColumnPickerFocus(sportFamily, focused, metricType);
    const saved = await save;
    if (this.destroyed) return;
    if (saved && this.activeLapColumnMenuGroup?.family === sportFamily) {
      const label = this.lapColumnMenuGroups.find(group => group.family === sportFamily)
        ?.selectedMetrics.find(metric => metric.type === metricType)?.label || metricType;
      this.lapColumnAnnouncement.set(`${label} moved to position ${next.indexOf(metricType) + 1} of ${next.length}.`);
    }
    this.restoreLapColumnPickerFocus(sportFamily, focused, metricType);
  }

  private getLapColumnPickerFocus(): HTMLElement | null {
    const active = this.document.activeElement;
    const dialog = this.lapColumnsDialogRef && this.document.getElementById(this.lapColumnsDialogRef.id);
    return active instanceof HTMLElement && dialog?.contains(active) ? active : null;
  }

  private restoreLapColumnPickerFocus(
    family: AppEventLapSportFamily, previous: HTMLElement | null, metricType?: string,
  ): void {
    const dialogId = this.lapColumnsDialogRef?.id;
    if (!previous || !dialogId || this.destroyed) return;
    afterNextRender(() => {
      if (this.destroyed || this.lapColumnsDialogRef?.id !== dialogId || this.activeLapColumnMenuGroup?.family !== family) return;
      const active = this.document.activeElement;
      if (active !== previous && active !== this.document.body) return;
      const dialog = this.document.getElementById(dialogId);
      const row = Array.from(dialog?.querySelectorAll<HTMLElement>('.lap-column-selected-row') || [])
        .find(element => element.dataset.lapColumn === metricType);
      // Keep focus in the dialog as optimistic rendering removes or disables controls,
      // without taking it back from a control the user chose while the save was pending.
      const target = previous.isConnected && !previous.matches(':disabled') ? previous
        : row?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')
          || dialog?.querySelector<HTMLElement>('.lap-column-selected-row input:not(:disabled), [data-lap-column-search]');
      target?.focus();
    }, { injector: this.injector });
  }

  private async saveLapColumnMetricTypes(
    sportFamily: AppEventLapSportFamily, nextSelectedMetricTypes: string[],
  ): Promise<boolean> {
    if (!this.canCustomize || this.savingLapColumnSportFamilies().has(sportFamily)) return false;
    const currentMetricTypes = getSelectedEventLapMetricTypes(this.eventDetailsSettings, sportFamily);
    const previousSettings = this.eventDetailsSettings;
    const nextSettings = normalizeEventDetailsSettings({
      lapTableColumnsBySportFamily: {
        ...previousSettings.lapTableColumnsBySportFamily,
        [sportFamily]: nextSelectedMetricTypes,
      },
    });
    const normalizedMetricTypes = getSelectedEventLapMetricTypes(nextSettings, sportFamily);
    if (normalizedMetricTypes.length === currentMetricTypes.length
      && normalizedMetricTypes.every((type, index) => type === currentMetricTypes[index])) {
      return false;
    }
    this.pendingLapColumnMetricTypes.set(sportFamily, normalizedMetricTypes);
    this.lapColumnAnnouncement.set('');
    this.hapticsService.selection();
    this.eventDetailsSettings = nextSettings;
    this.updateData();
    this.setSportFamilySaving(sportFamily, true);

    try {
      await this.userSettingsQuery.updateLapTableColumns(sportFamily, normalizedMetricTypes);
      if (!this.destroyed) this.hapticsService.success();
      return true;
    } catch {
      // Another sport's layout may have changed while this save was pending.
      this.eventDetailsSettings = normalizeEventDetailsSettings({
        lapTableColumnsBySportFamily: {
          ...this.eventDetailsSettings.lapTableColumnsBySportFamily,
          [sportFamily]: previousSettings.lapTableColumnsBySportFamily?.[sportFamily],
        },
      });
      this.updateData();
      if (!this.destroyed) {
        this.snackBar.open('Could not save lap columns. Please try again.', 'Close');
        this.hapticsService.error();
      }
      if (this.activeLapColumnMenuGroup?.family === sportFamily) {
        this.lapColumnAnnouncement.set('Could not save lap columns. Your previous columns have been restored.');
      }
      return false;
    } finally {
      this.pendingLapColumnMetricTypes.delete(sportFamily);
      this.setSportFamilySaving(sportFamily, false);
    }
  }

  public onLapColumnMetricSearchInput(group: LapColumnMenuGroup, event: Event): void {
    const searchTerm = (event.target as HTMLInputElement | null)?.value || '';
    this.setLapColumnMetricSearchTerm(group, searchTerm);
  }

  public clearLapColumnMetricSearch(group: LapColumnMenuGroup): void {
    if (!group.searchTerm) {
      return;
    }
    this.setLapColumnMetricSearchTerm(group, '');
    this.hapticsService.selection();
  }

  public onLapColumnSportSelectOpened(opened: boolean): void {
    if (opened) {
      this.hapticsService.selection();
    }
  }

  public onLapColumnMenuSportFamilyChange(family: string): void {
    const nextGroup = this.lapColumnMenuGroups.find((group) => group.family === family);
    if (!nextGroup || nextGroup === this.activeLapColumnMenuGroup) {
      return;
    }
    this.activeLapColumnMenuGroup = nextGroup;
    this.lapColumnAnnouncement.set('');
    this.hapticsService.selection();
    this.changeDetectorRef.markForCheck();
  }

  public toggleLapAdditionalMetrics(group: LapColumnMenuGroup): void {
    if (group.additionalMetricGroups.length === 0) {
      return;
    }
    group.showAdditionalMetrics = !group.showAdditionalMetrics;
    this.hapticsService.selection();
    this.changeDetectorRef.markForCheck();
  }

  private getLapColumnFamilyActivityTypes(family: AppEventLapSportFamily): unknown[] {
    return this.displayActivities
      .filter(activity => resolveEventLapSportFamily(activity.type) === family
        && (this.intervalActivities.has(activity) || getVisibleEventLaps(activity).length > 0))
      .map(activity => activity.type);
  }

  private updateLapColumnMenuGroups(): void {
    const sportFamilies = new Set<AppEventLapSportFamily>();
    this.displayActivities.forEach((activity) => {
      if (this.intervalActivities.has(activity) || getVisibleEventLaps(activity, this.displayEventActivities).length > 0) {
        sportFamilies.add(resolveEventLapSportFamily(activity.type));
      }
    });

    const activeFamily = this.activeLapColumnMenuGroup?.family;
    const existingGroupsByFamily = new Map(
      this.lapColumnMenuGroups.map((group) => [group.family, group]),
    );
    this.lapColumnMenuGroups = Array.from(sportFamilies).map((family) => {
      const metricGroups = getEventLapMetricOptionGroups(family).map(group => ({
        ...group, metrics: group.metrics.map(metric => metric.type === EVENT_LAP_SWOLF_COLUMN
          ? { ...metric, label: this.swolfColumnLabel } : metric),
      }));
      const additionalMetricGroups = getEventLapAdditionalMetricOptionGroups(family);
      const presentation = getEventLapSportFamilyPresentation(family);
      const existingGroup = existingGroupsByFamily.get(family);
      const selectedMetricTypes = getSelectedEventLapMetricTypes(
        this.eventDetailsSettings,
        family,
        this.getLapColumnFamilyActivityTypes(family),
      );
      const picker = getEventLapColumnPickerOptions([...metricGroups, ...additionalMetricGroups], selectedMetricTypes);
      const availableMetricGroups = getEventLapColumnPickerOptions(metricGroups, selectedMetricTypes).availableMetricGroups;
      const availableAdditionalMetricGroups = getEventLapColumnPickerOptions(additionalMetricGroups, selectedMetricTypes).availableMetricGroups;
      const metricAvailability = this.getLapMetricAvailability(
        family,
        [...metricGroups, ...additionalMetricGroups],
        new Set(selectedMetricTypes),
      );
      const selectedUnavailableMetricCount = selectedMetricTypes.filter((metricType) => (
        metricAvailability[metricType]?.availableTableCount === 0
      )).length;
      const additionalMetricTypes = additionalMetricGroups.flatMap(group => group.metrics.map(metric => metric.type));
      const selectedAdditionalMetricCount = additionalMetricTypes.filter(type => selectedMetricTypes.includes(type)).length;
      const recordedAdditionalMetricCount = additionalMetricTypes.filter(type => metricAvailability[type]?.availableTableCount > 0).length;
      if (existingGroup) {
        existingGroup.label = presentation.label;
        existingGroup.selectedMetricTypes = selectedMetricTypes;
        existingGroup.selectedMetrics = picker.selectedMetrics;
        existingGroup.metricAvailability = metricAvailability;
        existingGroup.selectedUnavailableMetricCount = selectedUnavailableMetricCount;
        existingGroup.metricGroups = metricGroups;
        existingGroup.additionalMetricGroups = additionalMetricGroups;
        existingGroup.selectedAdditionalMetricCount = selectedAdditionalMetricCount;
        existingGroup.recordedAdditionalMetricCount = recordedAdditionalMetricCount;
        existingGroup.availableAdditionalMetricGroups = availableAdditionalMetricGroups;
        existingGroup.filteredAdditionalMetricGroups = filterLapMetricGroups(availableAdditionalMetricGroups, existingGroup.searchTerm);
        existingGroup.additionalSearchMatchCount = existingGroup.searchTerm.trim()
          ? existingGroup.filteredAdditionalMetricGroups.reduce((count, group) => count + group.metrics.length, 0) : null;
        existingGroup.availableMetricGroups = availableMetricGroups;
        existingGroup.filteredMetricGroups = filterLapMetricGroups(
          availableMetricGroups,
          existingGroup.searchTerm,
        );
        return existingGroup;
      }

      return {
        family,
        label: presentation.label,
        selectedMetricTypes,
        selectedMetrics: picker.selectedMetrics,
        metricAvailability,
        selectedUnavailableMetricCount,
        metricGroups,
        additionalMetricGroups,
        availableAdditionalMetricGroups,
        filteredAdditionalMetricGroups: availableAdditionalMetricGroups,
        showAdditionalMetrics: false,
        selectedAdditionalMetricCount,
        recordedAdditionalMetricCount,
        additionalSearchMatchCount: null,
        availableMetricGroups,
        filteredMetricGroups: availableMetricGroups,
        searchTerm: '',
      };
    });
    this.activeLapColumnMenuGroup = this.lapColumnMenuGroups.find(
      (group) => group.family === activeFamily,
    ) || this.lapColumnMenuGroups[0] || null;
  }

  private getLapMetricAvailability(
    family: AppEventLapSportFamily,
    metricGroups: EventLapMetricOptionGroup[],
    selectedMetricTypes: ReadonlySet<string>,
  ): Record<string, LapMetricAvailability> {
    const tables = this.lapTableGroups
      .flatMap((lapTableGroup) => lapTableGroup.tables)
      .filter((table) => resolveEventLapSportFamily(table.activity.type) === family);
    const tableCount = tables.length;
    const metricTypes = metricGroups.flatMap(group => group.metrics.map(metric => metric.type));
    const availableMetricTypesByTable = tables.map(table => family === 'swimming' ? getAvailableEventLapMetricTypes(
      table.activity,
      this.getSelectableRows(table.dataSource.data).flatMap(row => row.lap ? [row.lap] : []),
      metricTypes,
      this.unitSettings,
      this.displayEventActivities,
    ) : new Set(table.columns));

    return Object.fromEntries(metricGroups
      .flatMap((metricGroup) => metricGroup.metrics)
      .map(({ type }) => {
        const availableTableCount = availableMetricTypesByTable.filter(types => types.has(type)).length;
        const label = !selectedMetricTypes.has(type)
          ? family === 'swimming' && availableTableCount > 0
            ? availableTableCount === tableCount
              ? type === DataHeartRateMax.type ? 'Available in current lap tables' : 'Recorded in current laps'
              : `${type === DataHeartRateMax.type ? 'Available' : 'Recorded'} in ${availableTableCount} of ${tableCount} lap tables`
            : null
          : availableTableCount === 0
          ? 'No data in current laps — hidden from the table'
          : availableTableCount < tableCount
            ? `Available in ${availableTableCount} of ${tableCount} lap tables`
            : null;
        return [type, { availableTableCount, tableCount, label }];
      }));
  }

  private getSelectedLapKeys(): Set<string> {
    return new Set(this.lapTableGroups.flatMap(group => group.tables)
      .flatMap(table => table.selection.selected.map(row => row.selectionKey))
      .filter((selectionKey): selectionKey is string => !!selectionKey));
  }

  private refreshSelectedSummary(table: LapTableView): void {
    const selectableRows = this.getSelectableRows(table.dataSource.data);
    selectableRows.forEach((row) => {
      row.isSelected = table.selection.isSelected(row);
    });
    table.dataSource.data.filter(row => row.members).forEach(row => {
      const selected = row.members.filter(member => member.isSelected).length;
      row.isSelected = selected === row.members.length;
      row.isPartiallySelected = selected > 0 && !row.isSelected;
    });
    const selectedRows = selectableRows.filter((row) => row.isSelected && row.lap);
    const selectedLaps = selectedRows
      .map((row) => row.lap)
      .filter((lap): lap is LapInterface => !!lap);
    const selectedCount = selectedLaps.length;
    const metricTypes = table.columns.filter((column) => (
      column !== LAP_TABLE_SELECTION_COLUMN && column !== '#'
      && column !== EVENT_LAP_STROKE_COLUMN && column !== 'lengths'
    ));
    const summary = Object.fromEntries(metricTypes.map((metricType) => [
      metricType,
      `— · 0/${selectedCount}`,
    ]));

    getSelectedEventLapSummaryMetrics(
      selectedRows.filter(row => !row.contextLabel).map(row => row.lap),
      metricTypes,
      this.unitSettings,
      table.activity.type,
      table.activity,
    ).forEach(({ type, display, availableCount }) => {
      summary[type] = `${display} · ${availableCount}/${selectedCount}`;
    });

    table.selectedCount = selectedCount;
    table.selectedSummary = summary;
    table.selectedSummaryLabel = selectedCount > 0 ? `Selected summary · ${selectedCount}` : '';
    table.allLapRowsSelected = selectableRows.length > 0 && selectedCount === selectableRows.length;
    table.someLapRowsSelected = selectedCount > 0 && !table.allLapRowsSelected;
  }

  private setLapColumnMetricSearchTerm(group: LapColumnMenuGroup, searchTerm: string): void {
    group.searchTerm = searchTerm;
    group.filteredAdditionalMetricGroups = filterLapMetricGroups(group.availableAdditionalMetricGroups, searchTerm);
    group.additionalSearchMatchCount = searchTerm.trim()
      ? group.filteredAdditionalMetricGroups.reduce((count, group) => count + group.metrics.length, 0) : null;
    group.filteredMetricGroups = filterLapMetricGroups(group.availableMetricGroups, searchTerm);
    this.changeDetectorRef.markForCheck();
  }

  private setSportFamilySaving(sportFamily: AppEventLapSportFamily, saving: boolean): void {
    const nextSavingSportFamilies = new Set(this.savingLapColumnSportFamilies());
    if (saving) {
      nextSavingSportFamilies.add(sportFamily);
    } else {
      nextSavingSportFamilies.delete(sportFamily);
    }
    this.savingLapColumnSportFamilies.set(nextSavingSportFamilies);
  }
}
