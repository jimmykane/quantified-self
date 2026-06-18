import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { ActivityInterface, DataInterface, EventInterface, ServiceNames, User } from '@sports-alliance/sports-lib';
import { AppColors } from '../../../services/color/app.colors';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { DataSpeed } from '@sports-alliance/sports-lib';
import { DataPace } from '@sports-alliance/sports-lib';
import { DataVerticalSpeed } from '@sports-alliance/sports-lib';
import { DataSwimPace } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { DataGradeAdjustedPace } from '@sports-alliance/sports-lib';
import { SelectionModel } from '@angular/cdk/collections';
import { DataExportOptions, DataExportService } from '../../../services/data-export.service';
import { expandCollapse } from '../../../animations/animations';
import { computeStatDiff } from '../../../helpers/stats-diff.helper';
import { normalizeUnitDerivedTypeLabel } from '../../../helpers/stat-label.helper';
import { buildSourceProviderPresentation } from '../../../helpers/provider-presentation.helper';
import { normalizeProviderServiceName, ProviderPresentation } from '@shared/provider-presentation';
import { AppEventService } from '../../../services/app.event.service';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-event-stats-table',
  templateUrl: './event.card.stats-table.component.html',
  styleUrls: ['./event.card.stats-table.component.css'],
  animations: [expandCollapse],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardStatsTableComponent implements OnChanges {
  @Input() event!: EventInterface;
  @Input() user: User | null = null;
  @Input() userUnitSettings!: UserUnitSettingsInterface;
  @Input() selectedActivities!: ActivityInterface[];
  @Input() showAsExpansion = true;
  data: MatTableDataSource<any> = new MatTableDataSource<any>();
  columns!: string[];
  appColors = AppColors;
  selection = new SelectionModel<any>(true, []);
  private readonly rowTypeKey = '__statType';
  private readonly verticalSpeedRegex = /vertical speed/i;
  private activitySeriesColumns: Array<{ columnKey: string; activity: ActivityInterface }> = [];
  private exportOptions: DataExportOptions | undefined;
  private exportOptionsRequestId = 0;

  constructor(
    private eventColorService: AppEventColorService,
    private dataExportService: DataExportService,
    private eventService: AppEventService,
  ) {
  }

  ngOnChanges(simpleChanges: any) {
    this.data = new MatTableDataSource<object>();
    this.columns = [];
    this.activitySeriesColumns = [];
    this.exportOptions = undefined;
    this.selection.clear();
    if (!this.selectedActivities.length || !this.userUnitSettings) {
      return;
    }

    // Create the columns
    const activityColumnKeys = this.selectedActivities.map((activity) => {
      const label = this.getActivityHeaderLabel(activity);
      const color = this.eventColorService.getActivityColor(this.selectedActivities, activity);
      return `${label} ${color}`;
    });
    this.columns = ['Name'].concat(activityColumnKeys);
    this.activitySeriesColumns = this.selectedActivities.map((activity, index) => ({
      activity,
      columnKey: activityColumnKeys[index],
    }));

    // Collect all the stat types from all the activities
    const stats = this.selectedActivities.reduce((statsMap: Map<string, DataInterface>, activity) => {
      activity.getStatsAsArray().forEach((stat) => {
        const statType = stat.getType();

        // Helper to check if a stat belongs to a base type group by traversing prototypes
        const isOfBaseType = (s: any, baseType: string) => {
          let current = Object.getPrototypeOf(s);
          while (current && typeof current.getType === 'function') {
            try {
              if (current.getType() === baseType) {
                return true;
              }
            } catch (e) {
              // Ignore errors if getType fails on some prototype
            }
            current = Object.getPrototypeOf(current);
          }
          return false;
        };

        const isSwimming = [ActivityTypes.Swimming, ActivityTypes['Open water swimming']].includes(activity.type as any);

        // Define unit preferences and their base types
        const unitPreferences: { baseType: string, units: string[], derivedTypes: Set<string>, onlyIfSwimming?: boolean }[] = [
          { baseType: DataSwimPace.type, units: this.userUnitSettings.swimPaceUnits, onlyIfSwimming: true },
          { baseType: DataPace.type, units: this.userUnitSettings.paceUnits },
          { baseType: DataGradeAdjustedPace.type, units: this.userUnitSettings.gradeAdjustedPaceUnits },
          { baseType: DataSpeed.type, units: this.userUnitSettings.speedUnits },
          { baseType: DataVerticalSpeed.type, units: this.userUnitSettings.verticalSpeedUnits },
        ].map((preference) => ({
          ...preference,
          derivedTypes: this.getPreferredDerivedTypes(preference.units),
        }));

        // Check each preference
        for (const pref of unitPreferences) {
          if (isOfBaseType(stat, pref.baseType)) {
            if (pref.onlyIfSwimming && !isSwimming) {
              return;
            }
            if (pref.derivedTypes.has(statType)) {
              statsMap.set(statType, stat);
            }
            return;
          }
        }

        // If it's not a derived type (or not one we specifically handle above), just add it if it's not unit-derived
        if (!DynamicDataLoader.isUnitDerivedDataType(statType)) {
          statsMap.set(statType, stat);
        }
      });
      return statsMap;
    }, new Map<string, DataInterface>());

    // Create the data as rows
    const data = Array.from(stats.values()).reduce((array, stat) => {
      let isComplexObject = false;
      const rowLabel = normalizeUnitDerivedTypeLabel(stat.getType(), stat.getDisplayType());
      const row = this.selectedActivities.reduce((rowObj: any, activity, index) => {
        const activityStat = activity.getStat(stat.getType());
        if (!activityStat) {
          return rowObj;
        }
        const displayValue = activityStat.getDisplayValue();
        const displayUnit = activityStat.getDisplayUnit();

        // Check if any activity has a value that renders as [object Object]
        if (String(displayValue).includes('[object Object]')) {
          isComplexObject = true;
        }

        rowObj[activityColumnKeys[index]] =
          (displayValue || '') +
          ' ' +
          (displayUnit || '');
        return rowObj;
      }, { Name: rowLabel, [this.rowTypeKey]: stat.getType() } as any);

      if (!isComplexObject) {
        array.push(row);
      }
      return array;
    }, [] as any[]);

    // If we are comparing only 2 activities then add a diff column.
    // @todo support more than 2 activities for diff
    if (this.event?.isMerge && this.selectedActivities.length === 2) {
      this.columns = this.columns.concat(['Difference']);
      Array.from(stats.values()).forEach((stat: DataInterface) => {
        const row = data.find(r => r[this.rowTypeKey] === stat.getType());
        if (!row) {
          return;
        }
        const diff = computeStatDiff(
          this.selectedActivities[0],
          this.selectedActivities[1],
          stat.getType(),
          stat.getType(),
          this.userUnitSettings
        );
        if (!diff) {
          return;
        }
        row['Difference'] = {
          display: diff.display,
          percent: diff.percent,
        };
      })
    }

    data.sort((left, right) => {
      if (left.Name < right.Name) {
        return -1;
      }
      if (left.Name > right.Name) {
        return 1;
      }
      return 0;
    });

    // Add Software Version row (if available)
    const swVersionRow = { Name: 'Software Version' } as any;
    let hasSwVersion = false;

    this.selectedActivities.forEach((activity, index) => {
      const creator = activity.creator as any;
      // Check commonly used fields for SW version
      const version = creator.swInfo || creator.swVersion || creator.version;

      if (version !== undefined && version !== null && version !== '') {
        hasSwVersion = true;
        swVersionRow[activityColumnKeys[index]] = version;
      } else {
        swVersionRow[activityColumnKeys[index]] = '';
      }
    });

    if (hasSwVersion) {
      data.push(swVersionRow);
    }

    // debugger;

    // Set the data
    this.data = new MatTableDataSource<any>(data);

    // Custom filter predicate for multi-term search (comma-separated, OR logic)
    this.data.filterPredicate = (row: any, filter: string) => {
      const terms = filter.split(',').map(t => t.trim()).filter(t => t.length > 0);
      if (terms.length === 0) return true;

      const rowString = Object.values(row).join(' ').toLowerCase();
      return terms.some(term => rowString.includes(term));
    };

    this.refreshExportOptions();
  }

  applyFilter(event: any) {
    this.data.filter = event.target.value.trim().toLowerCase();
  }

  getColumnHeaderName(columnHeader: string): string {
    return this.dataExportService.getColumnHeaderName(columnHeader);
  }

  getColumnHeaderColor(columnHeader: string): string {
    if (columnHeader === 'Name' || columnHeader === 'Difference') {
      return 'inherit';
    }
    return columnHeader.slice(-7);
  }

  shouldShowActivityHeaderLabel(columnHeader: string): boolean {
    if (columnHeader === 'Name') {
      return false;
    }
    if (columnHeader === 'Difference') {
      return true;
    }
    if (!this.event?.isMerge && (this.selectedActivities?.length ?? 0) === 1) {
      return false;
    }
    return true;
  }

  getDifferenceColor(percent: number): string {
    return this.eventColorService.getDifferenceColor(percent);
  }

  shouldShowHeaderRow(): boolean {
    return (this.selectedActivities?.length ?? 0) > 1;
  }

  toggleRow(row: any) {
    this.selection.toggle(row);
  }

  clearSelection() {
    this.selection.clear();
  }

  isSelectionEmpty(): boolean {
    return this.selection.isEmpty();
  }

  copyToClipboard(): void {
    const selectedRows = this.selection.selected;
    if (selectedRows.length === 0) return;
    this.dataExportService.copyToMarkdown(selectedRows, this.columns, this.exportOptions);
  }

  copyToSheets(): void {
    const selectedRows = this.selection.selected;
    if (selectedRows.length === 0) return;
    void this.dataExportService.copyToSheets(selectedRows, this.columns, this.exportOptions);
  }

  private getActivityHeaderLabel(activity: ActivityInterface): string {
    if (!this.event?.isMerge && this.selectedActivities?.length === 1) {
      return 'Value';
    }
    if (this.event?.isMerge) {
      return activity.creator?.name || 'Device';
    }
    const activityType = (activity as any)?.type;
    if (activityType === null || activityType === undefined) {
      return 'Activity';
    }
    if (typeof activityType === 'number') {
      return ActivityTypes[activityType] || String(activityType);
    }
    return String(activityType);
  }

  private getSafeType(stat: DataInterface): string {
    try {
      return String(stat?.getType?.() || '');
    } catch {
      return '';
    }
  }

  private getSafeDisplayType(stat: DataInterface): string {
    try {
      return String(stat?.getDisplayType?.() || '');
    } catch {
      return '';
    }
  }

  private getSafeDisplayValue(stat: DataInterface): string {
    try {
      return String(stat?.getDisplayValue?.() ?? '');
    } catch {
      return '';
    }
  }

  private getSafeDisplayUnit(stat: DataInterface): string {
    try {
      return String(stat?.getDisplayUnit?.() ?? '');
    } catch {
      return '';
    }
  }

  private getPreferredDerivedTypes(unitTypes: string[] = []): Set<string> {
    const preferredTypes = new Set<string>();

    unitTypes.forEach((unitType) => {
      if (!unitType) {
        return;
      }

      preferredTypes.add(unitType);
      const avgType = DynamicDataLoader.dataTypeAvgDataType[unitType];
      const minType = DynamicDataLoader.dataTypeMinDataType[unitType];
      const maxType = DynamicDataLoader.dataTypeMaxDataType[unitType];
      if (avgType) {
        preferredTypes.add(avgType);
      }
      if (minType) {
        preferredTypes.add(minType);
      }
      if (maxType) {
        preferredTypes.add(maxType);
      }
    });

    return preferredTypes;
  }

  private buildExportOptions(knownSourceServices: ServiceNames[]): DataExportOptions | undefined {
    if (knownSourceServices.length === 0) {
      return undefined;
    }

    const ambiguousSeriesColumns = this.getAmbiguousActivitySeriesColumns();
    if (ambiguousSeriesColumns.length === 0) {
      return undefined;
    }

    if (knownSourceServices.length === 1) {
      const attributionLabel = this.buildAttributionLabel(knownSourceServices);
      return attributionLabel ? { attributionLabel } : undefined;
    }

    const seriesPresentations = this.buildSeriesPresentations(knownSourceServices, ambiguousSeriesColumns);
    const unresolvedAmbiguousColumnCount = ambiguousSeriesColumns.length - Object.keys(seriesPresentations).length;
    const attributionLabel = unresolvedAmbiguousColumnCount > 0
      ? this.buildAttributionLabel(knownSourceServices)
      : null;

    if (!attributionLabel && Object.keys(seriesPresentations).length === 0) {
      return undefined;
    }

    const options: DataExportOptions = {};
    if (attributionLabel) {
      options.attributionLabel = attributionLabel;
    }
    if (Object.keys(seriesPresentations).length > 0) {
      options.seriesPresentations = seriesPresentations;
    }

    return Object.keys(options).length > 0 ? options : undefined;
  }

  private refreshExportOptions(): void {
    const fallbackServices = this.inferSourceServicesFromActivities();
    this.exportOptions = this.buildExportOptions(fallbackServices);

    const eventID = this.event?.getID?.();
    if (!this.user || !eventID) {
      return;
    }

    const requestId = ++this.exportOptionsRequestId;
    this.eventService.getEventMetaDataKeys(this.user, eventID)
      .pipe(take(1))
      .subscribe({
        next: (metadataKeys) => {
          if (requestId !== this.exportOptionsRequestId) {
            return;
          }

          const metadataServices = Array.from(new Set(
            metadataKeys
              .map(serviceName => normalizeProviderServiceName(serviceName))
              .filter((serviceName): serviceName is ServiceNames => !!serviceName),
          ));
          if (metadataServices.length === 0) {
            return;
          }

          this.exportOptions = this.buildExportOptions(metadataServices);
        },
        error: () => {
          if (requestId !== this.exportOptionsRequestId) {
            return;
          }
          this.exportOptions = this.exportOptions || this.buildExportOptions(fallbackServices);
        },
      });
  }

  private inferSourceServicesFromActivities(): ServiceNames[] {
    return Array.from(new Set(
      this.selectedActivities
        .map(activity => this.inferSourceServiceFromActivity(activity))
        .filter((serviceName): serviceName is ServiceNames => !!serviceName),
    ));
  }

  private buildAttributionLabel(sourceServices: ServiceNames[]): string | null {
    if (sourceServices.length === 1) {
      return buildSourceProviderPresentation(sourceServices[0], this.event)?.exportLabel || null;
    }

    const labels = sourceServices
      .map(serviceName => buildSourceProviderPresentation(serviceName)?.exportLabel || null)
      .filter((label): label is string => !!label);
    return labels.length > 0 ? labels.join(' | ') : null;
  }

  private getActivitySeriesColumnsForExport(): Array<{ columnKey: string; activity: ActivityInterface }> {
    if (this.activitySeriesColumns.length > 0) {
      return this.activitySeriesColumns;
    }

    const activityColumns = this.columns.filter(column => column !== 'Name' && column !== 'Difference');
    return activityColumns
      .map((columnKey, index) => ({
        columnKey,
        activity: this.selectedActivities[index],
      }))
      .filter((entry): entry is { columnKey: string; activity: ActivityInterface } => !!entry.activity);
  }

  private getAmbiguousActivitySeriesColumns(): Array<{ columnKey: string; activity: ActivityInterface }> {
    return this.getActivitySeriesColumnsForExport()
      .filter(entry => this.isActivitySeriesHeaderAmbiguous(entry.columnKey));
  }

  private buildSeriesPresentations(
    sourceServices: ServiceNames[],
    seriesColumns: Array<{ columnKey: string; activity: ActivityInterface }>,
  ): Record<string, ProviderPresentation> {
    return seriesColumns.reduce<Record<string, ProviderPresentation>>((presentations, entry) => {
      const presentation = this.buildActivitySeriesPresentation(entry.activity, sourceServices);
      if (presentation) {
        presentations[entry.columnKey] = presentation;
      }
      return presentations;
    }, {});
  }

  private buildActivitySeriesPresentation(
    activity: ActivityInterface,
    sourceServices: ServiceNames[],
  ): ProviderPresentation | null {
    const inferredService = this.inferSourceServiceFromActivity(activity, sourceServices);
    const serviceName = inferredService || (sourceServices.length === 1 ? sourceServices[0] : null);
    if (!serviceName) {
      return null;
    }

    return buildSourceProviderPresentation(serviceName);
  }

  private inferSourceServiceFromActivity(
    activity: ActivityInterface,
    allowedSourceServices: ServiceNames[] = [
      ServiceNames.GarminAPI,
      ServiceNames.SuuntoApp,
      ServiceNames.COROSAPI,
    ],
  ): ServiceNames | null {
    const hints = this.getActivityProviderHints(activity);
    if (hints.some(hint => hint.includes('coros')) && allowedSourceServices.includes(ServiceNames.COROSAPI)) {
      return ServiceNames.COROSAPI;
    }
    if (hints.some(hint => hint.includes('suunto')) && allowedSourceServices.includes(ServiceNames.SuuntoApp)) {
      return ServiceNames.SuuntoApp;
    }
    if (hints.some(hint => hint.includes('garmin')) && allowedSourceServices.includes(ServiceNames.GarminAPI)) {
      return ServiceNames.GarminAPI;
    }
    return null;
  }

  private getActivityProviderHints(activity: ActivityInterface): string[] {
    const hints = new Set<string>();
    const creator = (activity as { creator?: { name?: unknown; devices?: Array<{ name?: unknown; manufacturer?: unknown; type?: unknown }> } }).creator;

    const creatorName = this.normalizeProviderHint(creator?.name);
    if (creatorName) {
      hints.add(creatorName);
    }

    const devices = Array.isArray(creator?.devices) ? creator.devices : [];
    devices.forEach(device => {
      [device?.name, device?.manufacturer, device?.type]
        .map(value => this.normalizeProviderHint(value))
        .filter((value): value is string => !!value)
        .forEach(value => hints.add(value));
    });

    return [...hints.values()];
  }

  private normalizeProviderHint(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim().toLowerCase()
      : null;
  }

  private isActivitySeriesHeaderAmbiguous(columnKey: string): boolean {
    const headerLabel = this.getColumnHeaderName(columnKey).trim();
    if (!headerLabel) {
      return true;
    }

    if (!this.event?.isMerge) {
      return true;
    }

    return this.isGenericMergeSeriesLabel(headerLabel);
  }

  private isGenericMergeSeriesLabel(label: string): boolean {
    const normalizedLabel = label.trim().toLowerCase();
    if (!normalizedLabel) {
      return true;
    }

    return normalizedLabel === 'device'
      || normalizedLabel === 'activity'
      || normalizedLabel === 'reference'
      || normalizedLabel === 'test'
      || /^player\s+[a-z0-9-]+$/i.test(normalizedLabel)
      || /^device\s+[a-z0-9-]+$/i.test(normalizedLabel)
      || /^activity\s+[a-z0-9-]+$/i.test(normalizedLabel);
  }
}
