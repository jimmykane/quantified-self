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
import {
  ActivityInterface,
  DataDistance,
  DataDuration,
  DataInterface,
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
  getEventLapMetricOptionGroups,
  getEventLapSportFamilyPresentation,
  getSelectedEventLapMetricTypes,
  normalizeEventDetailsSettings,
  resolveEventLapSportFamily,
} from '../../../helpers/event-lap-table-columns.helper';
import {
  AppEventDetailsSettingsInterface,
  AppEventLapSportFamily,
} from '../../../models/app-user.interface';

interface LapTableRow extends Record<string, string | number> {
  '#': number;
}

interface LapColumnMenuGroup {
  family: AppEventLapSportFamily;
  label: string;
  icon: string;
  selectedMetricTypes: string[];
  metricGroups: EventLapMetricOptionGroup[];
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
  public lapColumnMenuGroups: LapColumnMenuGroup[] = [];
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
    this.dataSourcesMap.clear();
    this.columnsMap.clear();

    if (!this.selectedActivities) {
      this.lapColumnMenuGroups = [];
      this.changeDetectorRef.markForCheck();
      return;
    }

    const lapTypesWithData = new Set<LapTypes>();

    this.selectedActivities.forEach(activity => {
      this.availableLapTypes.forEach(lapType => {
        const data = this.generateLapData(activity, lapType);
        const key = this.getKey(activity, lapType);

        if (data.length > 0) {
          lapTypesWithData.add(lapType);
          const dataSource = new MatTableDataSource(data);
          this.dataSourcesMap.set(key, dataSource);
          this.columnsMap.set(key, this.calculateColumns(dataSource, activity.type));
        }
      });
    });

    this.availableLapTypes = this.availableLapTypes.filter(lapType => lapTypesWithData.has(lapType));
    this.updateLapColumnMenuGroups();
    this.changeDetectorRef.markForCheck();
  }

  private getKey(activity: ActivityInterface, lapType: LapTypes): string {
    return `${activity.getID()}-${lapType}`;
  }

  private generateLapData(activity: ActivityInterface, lapType: LapTypes): LapTableRow[] {
    const laps = activity.getLaps?.() || [];
    return laps.filter(lap => lap.type === lapType).reduce<LapTableRow[]>((lapDataArray, lap, index) => {
      const row: LapTableRow = {
        '#': index + 1,
      };

      this.getColumnsToDisplay(activity.type)
        .filter((column) => column !== '#')
        .forEach((metricType) => {
          row[metricType] = formatEventLapMetric(
            this.getLapMetricStat(lap, metricType),
            metricType,
            this.unitSettings,
            activity.type,
          );
        });

      lapDataArray.push(row);
      return lapDataArray;
    }, []);
  }

  private getLapMetricStat(lap: LapInterface, metricType: string): DataInterface | null {
    try {
      if (metricType === DataDuration.type) {
        return lap.getDuration?.() || null;
      }
      if (metricType === DataDistance.type) {
        return lap.getDistance?.() || null;
      }
      return lap.getStat?.(metricType) || null;
    } catch {
      return null;
    }
  }

  private calculateColumns(dataSource: MatTableDataSource<LapTableRow>, activityType: unknown): string[] {
    return this.getColumnsToDisplay(activityType).filter(column => {
      if (column === '#') {
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

  isSticky(column: string) {
    return column === '#'
  }

  isStickyEnd(_column: string) {
    return false;
  }

  public async onLapColumnSelectionChange(
    sportFamily: AppEventLapSportFamily,
    event: MatSelectionListChange,
  ): Promise<void> {
    if (!this.canCustomize || this.savingLapColumnSportFamilies().has(sportFamily)) {
      return;
    }

    const selectedMetricTypes = event.source.selectedOptions.selected
      .map((option) => option.value)
      .filter((value): value is string => typeof value === 'string');
    const previousSettings = this.eventDetailsSettings;
    const nextSettings = normalizeEventDetailsSettings({
      lapTableColumnsBySportFamily: {
        ...previousSettings.lapTableColumnsBySportFamily,
        [sportFamily]: selectedMetricTypes,
      },
    });
    this.eventDetailsSettings = nextSettings;
    this.updateData();
    this.setSportFamilySaving(sportFamily, true);

    try {
      await this.userSettingsQuery.updateLapTableColumns(sportFamily, selectedMetricTypes);
    } catch {
      this.eventDetailsSettings = previousSettings;
      this.updateData();
      this.snackBar.open('Could not save lap columns. Please try again.', 'Close');
    } finally {
      this.setSportFamilySaving(sportFamily, false);
    }
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

    const metricGroups = getEventLapMetricOptionGroups();
    this.lapColumnMenuGroups = Array.from(sportFamilies).map((family) => {
      const presentation = getEventLapSportFamilyPresentation(family);
      return {
        family,
        label: presentation.label,
        icon: presentation.icon,
        selectedMetricTypes: getSelectedEventLapMetricTypes(this.eventDetailsSettings, family),
        metricGroups,
      };
    });
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
