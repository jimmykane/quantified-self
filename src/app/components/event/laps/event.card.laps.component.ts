import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatSelectionListChange } from '@angular/material/list';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import {
  ActivityInterface,
  EventInterface,
  LapInterface,
  LapTypes,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective } from '../../data-table/data-table-abstract.directive';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { isEventLapTypeAllowed } from '../../../helpers/event-lap-type.helper';
import {
  EventLapMetricOptionGroup,
  formatEventLapMetric,
  getAverageEventLapMetrics,
  getEventLapMetricOptionGroups,
  getEventLapSportFamilyPresentation,
  getEventLapMetricStat,
  getSelectedEventLapSummaryMetrics,
  getSelectedEventLapMetricTypes,
  normalizeEventDetailsSettings,
  resolveEventLapSportFamily,
} from '../../../helpers/event-lap-table-columns.helper';
import {
  AppEventDetailsSettingsInterface,
  AppEventLapSportFamily,
} from '../../../models/app-user.interface';

interface LapTableRow extends Record<string, string | number | boolean | LapInterface | undefined> {
  '#': string | number;
  isLapAverage?: boolean;
  isSelected?: boolean;
  lap?: LapInterface;
  selectionKey?: string;
}

interface LapColumnMenuGroup {
  family: AppEventLapSportFamily;
  label: string;
  icon: string;
  selectedMetricTypes: string[];
  metricGroups: EventLapMetricOptionGroup[];
  filteredMetricGroups: EventLapMetricOptionGroup[];
  searchTerm: string;
}

interface LapTableView {
  key: string;
  activity: ActivityInterface;
  dataSource: MatTableDataSource<LapTableRow>;
  columns: string[];
  selection: SelectionModel<LapTableRow>;
  selectedCount: number;
  selectedSummary: Record<string, string>;
  selectedSummaryLabel: string;
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

export class EventCardLapsComponent extends DataTableAbstractDirective implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Input() unitSettings: UserUnitSettingsInterface;
  @Input() canCustomize = false;

  public availableLapTypes: LapTypes[] = [];

  public dataSourcesMap = new Map<string, MatTableDataSource<LapTableRow>>();
  public columnsMap = new Map<string, string[]>();
  public lapTableGroups: LapTableGroup[] = [];
  public lapColumnMenuGroups: LapColumnMenuGroup[] = [];
  public activeLapColumnMenuGroup: LapColumnMenuGroup | null = null;
  public hasMultipleEventActivities = false;
  public savingLapColumnSportFamilies = signal(new Set<AppEventLapSportFamily>());
  private eventDetailsSettings: AppEventDetailsSettingsInterface = normalizeEventDetailsSettings(null);
  private readonly userSettingsQuery = inject(AppUserSettingsQueryService);
  private readonly snackBar = inject(MatSnackBar);

  constructor(protected changeDetectorRef: ChangeDetectorRef) {
    super(changeDetectorRef);
    effect(() => {
      this.eventDetailsSettings = this.userSettingsQuery.eventDetailsSettings();
      this.updateData();
    });
  }

  ngOnChanges() {
    this.hasMultipleEventActivities = (this.event?.getActivities?.() || []).length > 1;
    this.updateAvailableLapTypes();
    this.updateData();
  }

  private updateAvailableLapTypes() {
    this.availableLapTypes = [];
    if (this.selectedActivities) {
      this.selectedActivities.forEach(activity => {
        const laps = activity.getLaps?.() || [];
        this.availableLapTypes = [...new Set(this.availableLapTypes.concat(
          laps.map(lap => lap.type)
            .filter(lapType => this.shouldShowLapType(lapType))
        ))];
      });
    }
  }

  private shouldShowLapType(lapType: LapTypes): boolean {
    return isEventLapTypeAllowed(lapType, []);
  }

  private updateData() {
    const selectedLapKeysByTable = this.getSelectedLapKeysByTable();
    this.dataSourcesMap.clear();
    this.columnsMap.clear();
    this.lapTableGroups = [];

    if (!this.selectedActivities) {
      this.lapColumnMenuGroups = [];
      this.changeDetectorRef.markForCheck();
      return;
    }

    const lapTypesWithData = new Set<LapTypes>();
    const tablesByKey = new Map<string, LapTableView>();

    this.selectedActivities.forEach(activity => {
      this.availableLapTypes.forEach(lapType => {
        const data = this.generateLapData(activity, lapType);
        const key = this.getKey(activity, lapType);

        if (data.length > 0) {
          lapTypesWithData.add(lapType);
          const dataSource = new MatTableDataSource(data);
          this.dataSourcesMap.set(key, dataSource);
          const columns = this.calculateColumns(dataSource, activity.type);
          this.columnsMap.set(key, columns);
          const selection = new SelectionModel<LapTableRow>(true);
          const selectedLapKeys = selectedLapKeysByTable.get(key);
          const selectableRows = data.filter((row) => !row.isLapAverage);
          if (selectedLapKeys) {
            selection.select(...selectableRows.filter((row) => selectedLapKeys.has(row.selectionKey || '')));
          }
          const table: LapTableView = {
            key,
            activity,
            dataSource,
            columns,
            selection,
            selectedCount: 0,
            selectedSummary: {},
            selectedSummaryLabel: '',
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
      tables: this.selectedActivities
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
    this.changeDetectorRef.markForCheck();
  }

  private getKey(activity: ActivityInterface, lapType: LapTypes): string {
    return `${activity.getID()}-${lapType}`;
  }

  private generateLapData(activity: ActivityInterface, lapType: LapTypes): LapTableRow[] {
    const laps = (activity.getLaps?.() || []).filter(lap => lap.type === lapType);
    const metricTypes = this.getColumnsToDisplay(activity.type).filter((column) => column !== '#');
    const lapRows = laps.reduce<LapTableRow[]>((lapDataArray, lap, index) => {
      const row: LapTableRow = {
        '#': index + 1,
      };
      const lapIdentity = Number.isFinite(lap.lapId) ? lap.lapId : index;
      Object.defineProperties(row, {
        isSelected: { value: false, writable: true, enumerable: false },
        lap: { value: lap, enumerable: false },
        selectionKey: {
          value: `${this.getKey(activity, lapType)}-${lapIdentity}`,
          enumerable: false,
        },
      });

      metricTypes.forEach((metricType) => {
        row[metricType] = formatEventLapMetric(
          getEventLapMetricStat(lap, metricType),
          metricType,
          this.unitSettings,
          activity.type,
        );
      });

      lapDataArray.push(row);
      return lapDataArray;
    }, []);

    const averageMetrics = getAverageEventLapMetrics(laps, metricTypes, this.unitSettings, activity.type);
    if (averageMetrics.length === 0) {
      return lapRows;
    }

    const averageRow: LapTableRow = {
      '#': 'Avg',
      isLapAverage: true,
    };
    averageMetrics.forEach(({ type, display }) => {
      averageRow[type] = display;
    });
    return [averageRow, ...lapRows];
  }

  private calculateColumns(dataSource: MatTableDataSource<LapTableRow>, activityType: unknown): string[] {
    return [LAP_TABLE_SELECTION_COLUMN, ...this.getColumnsToDisplay(activityType)].filter(column => {
      if (column === LAP_TABLE_SELECTION_COLUMN || column === '#') {
        return true;
      }
      return dataSource.data.some(row => {
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
      ),
    ];
  }

  isSticky(column: string): boolean {
    return column === LAP_TABLE_SELECTION_COLUMN || column === '#';
  }

  isStickyEnd(_column: string): boolean {
    return false;
  }

  public toggleLapSelection(table: LapTableView, row: LapTableRow): void {
    if (row.isLapAverage) {
      return;
    }
    table.selection.toggle(row);
    this.refreshSelectedSummary(table);
    this.changeDetectorRef.markForCheck();
  }

  public toggleAllLapSelections(table: LapTableView): void {
    const selectableRows = table.dataSource.data.filter((row) => !row.isLapAverage);
    if (table.allLapRowsSelected) {
      table.selection.clear();
    } else {
      table.selection.select(...selectableRows);
    }
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

    const selectedMetricTypes = new Set(
      getSelectedEventLapMetricTypes(this.eventDetailsSettings, sportFamily),
    );
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
    const nextSelectedMetricTypes = Array.from(selectedMetricTypes);
    const previousSettings = this.eventDetailsSettings;
    const nextSettings = normalizeEventDetailsSettings({
      lapTableColumnsBySportFamily: {
        ...previousSettings.lapTableColumnsBySportFamily,
        [sportFamily]: nextSelectedMetricTypes,
      },
    });
    this.eventDetailsSettings = nextSettings;
    this.updateData();
    this.setSportFamilySaving(sportFamily, true);

    try {
      await this.userSettingsQuery.updateLapTableColumns(sportFamily, nextSelectedMetricTypes);
    } catch {
      this.eventDetailsSettings = previousSettings;
      this.updateData();
      this.snackBar.open('Could not save lap columns. Please try again.', 'Close');
    } finally {
      this.setSportFamilySaving(sportFamily, false);
    }
  }

  public onLapColumnMetricSearchInput(group: LapColumnMenuGroup, event: Event): void {
    const searchTerm = (event.target as HTMLInputElement | null)?.value || '';
    this.setLapColumnMetricSearchTerm(group, searchTerm);
  }

  public clearLapColumnMetricSearch(group: LapColumnMenuGroup): void {
    this.setLapColumnMetricSearchTerm(group, '');
  }

  public onLapColumnMenuSportFamilyChange(family: string): void {
    const nextGroup = this.lapColumnMenuGroups.find((group) => group.family === family);
    if (!nextGroup || nextGroup === this.activeLapColumnMenuGroup) {
      return;
    }
    this.activeLapColumnMenuGroup = nextGroup;
    this.changeDetectorRef.markForCheck();
  }

  private updateLapColumnMenuGroups(): void {
    const sportFamilies = new Set<AppEventLapSportFamily>();
    this.selectedActivities.forEach((activity) => {
      const laps = activity.getLaps?.() || [];
      const hasVisibleLaps = laps.some((lap) => this.shouldShowLapType(lap.type));
      if (hasVisibleLaps) {
        sportFamilies.add(resolveEventLapSportFamily(activity.type));
      }
    });

    const activeFamily = this.activeLapColumnMenuGroup?.family;
    const existingGroupsByFamily = new Map(
      this.lapColumnMenuGroups.map((group) => [group.family, group]),
    );
    const metricGroups = getEventLapMetricOptionGroups();
    this.lapColumnMenuGroups = Array.from(sportFamilies).map((family) => {
      const presentation = getEventLapSportFamilyPresentation(family);
      const existingGroup = existingGroupsByFamily.get(family);
      if (existingGroup) {
        existingGroup.label = presentation.label;
        existingGroup.icon = presentation.icon;
        existingGroup.selectedMetricTypes = getSelectedEventLapMetricTypes(
          this.eventDetailsSettings,
          family,
        );
        existingGroup.metricGroups = metricGroups;
        existingGroup.filteredMetricGroups = filterLapMetricGroups(
          metricGroups,
          existingGroup.searchTerm,
        );
        return existingGroup;
      }

      return {
        family,
        label: presentation.label,
        icon: presentation.icon,
        selectedMetricTypes: getSelectedEventLapMetricTypes(this.eventDetailsSettings, family),
        metricGroups,
        filteredMetricGroups: metricGroups,
        searchTerm: '',
      };
    });
    this.activeLapColumnMenuGroup = this.lapColumnMenuGroups.find(
      (group) => group.family === activeFamily,
    ) || this.lapColumnMenuGroups[0] || null;
  }

  private getSelectedLapKeysByTable(): Map<string, Set<string>> {
    return new Map(this.lapTableGroups.flatMap((group) => group.tables.map((table) => [
      table.key,
      new Set(table.selection.selected
        .map((row) => row.selectionKey)
        .filter((selectionKey): selectionKey is string => !!selectionKey)),
    ])));
  }

  private refreshSelectedSummary(table: LapTableView): void {
    const selectableRows = table.dataSource.data.filter((row) => !row.isLapAverage);
    selectableRows.forEach((row) => {
      row.isSelected = table.selection.isSelected(row);
    });
    const selectedRows = selectableRows.filter((row) => row.isSelected && row.lap);
    const selectedLaps = selectedRows
      .map((row) => row.lap)
      .filter((lap): lap is LapInterface => !!lap);
    const selectedCount = selectedLaps.length;
    const metricTypes = table.columns.filter((column) => (
      column !== LAP_TABLE_SELECTION_COLUMN && column !== '#'
    ));
    const summary = Object.fromEntries(metricTypes.map((metricType) => [
      metricType,
      `— · 0/${selectedCount}`,
    ]));

    getSelectedEventLapSummaryMetrics(
      selectedLaps,
      metricTypes,
      this.unitSettings,
      table.activity.type,
    ).forEach(({ type, display, availableCount }) => {
      summary[type] = `${display} · ${availableCount}/${selectedCount}`;
    });

    table.selectedCount = selectedCount;
    table.selectedSummary = summary;
    table.selectedSummaryLabel = selectedCount > 0 ? `Selected avg · ${selectedCount}` : '';
    table.allLapRowsSelected = selectableRows.length > 0 && selectedCount === selectableRows.length;
    table.someLapRowsSelected = selectedCount > 0 && !table.allLapRowsSelected;
  }

  private setLapColumnMetricSearchTerm(group: LapColumnMenuGroup, searchTerm: string): void {
    group.searchTerm = searchTerm;
    group.filteredMetricGroups = filterLapMetricGroups(group.metricGroups, searchTerm);
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
