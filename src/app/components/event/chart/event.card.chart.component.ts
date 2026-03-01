import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  effect,
  inject,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { throttleTime } from 'rxjs/operators';
import { Subject, Subscription, asyncScheduler } from 'rxjs';
import {
  ActivityInterface,
  ChartThemes,
  DataDistance,
  DataStrydDistance,
  DynamicDataLoader,
  EventInterface,
  LapTypes,
  User,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { AppChartSettingsLocalStorageService } from '../../../services/storage/app.chart.settings.local.storage.service';
import { LoggerService } from '../../../services/logger.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { AppBreakpoints } from '../../../constants/breakpoints';
import {
  buildEventChartPanels,
  buildEventLapMarkers,
  buildEventZoomOverviewData,
  EventChartLapMarker,
  EventChartPanelModel,
} from '../../../helpers/event-echarts-data.helper';
import { resolveEventSeriesColor } from '../../../helpers/event-echarts-style.helper';
import {
  EventChartRange,
  resolveEventChartXAxisType,
} from '../../../helpers/event-echarts-xaxis.helper';

interface EventDataTypeLegendItem {
  dataType: string;
  label: string;
  color: string;
  visible: boolean;
}

const LEGEND_MUTED_DOT_COLOR = 'var(--mat-sys-outline)';

@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventCardChartComponent implements OnInit, OnChanges, OnDestroy {
  @Input() event!: EventInterface;
  @Input() targetUserID!: string;
  @Input() user!: User;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible!: boolean;
  @Input() waterMark?: string;

  @Output() loadingStatus = new EventEmitter<boolean>();

  public isLoading = false;
  public chartTheme: ChartThemes = ChartThemes.Material;
  public allChartPanels: EventChartPanelModel[] = [];
  public chartPanels: EventChartPanelModel[] = [];
  public dataTypeLegendItems: EventDataTypeLegendItem[] = [];
  public lapMarkers: EventChartLapMarker[] = [];
  public xDomain: EventChartRange | null = null;
  public zoomBarOverviewData: Array<[number, number]> = [];
  public renderedXAxisType: XAxisTypes = XAxisTypes.Duration;
  public showDateOnTimeAxis = false;
  public zoomSyncGroupId: string | null = null;

  public get showAllData() { return this.userSettingsQuery.chartSettings()?.showAllData ?? false; }
  public set showAllData(value: boolean) {
    if (value !== this.showAllData) {
      void this.userSettingsQuery.updateChartSettings({ showAllData: value })
        .then(() => this.queueRebuild('showAllData'))
        .catch((error) => this.logger.error('[EventCardChart] Failed to persist showAllData', error));
    }
  }

  public get showLaps() { return this.userSettingsQuery.chartSettings()?.showLaps ?? true; }
  public set showLaps(value: boolean) {
    if (value !== this.showLaps) {
      void this.userSettingsQuery.updateChartSettings({ showLaps: value })
        .then(() => this.queueRebuild('showLaps'))
        .catch((error) => this.logger.error('[EventCardChart] Failed to persist showLaps', error));
    }
  }

  public get lapTypes(): LapTypes[] {
    const configuredLapTypes = this.userSettingsQuery.chartSettings()?.lapTypes;
    return Array.isArray(configuredLapTypes) && configuredLapTypes.length > 0
      ? configuredLapTypes
      : AppUserUtilities.getDefaultChartLapTypes();
  }

  public get xAxisType() { return this.xAxisTypeOverride ?? this.userSettingsQuery.chartSettings()?.xAxisType ?? XAxisTypes.Duration; }
  public set xAxisType(value: XAxisTypes) {
    if (value === this.xAxisType) {
      return;
    }

    this.xAxisTypeOverride = value;
    this.queueRebuild('xAxisType-setter');

    void this.userSettingsQuery.updateChartSettings({ xAxisType: value })
      .then(() => {
        this.xAxisTypeOverride = null;
      })
      .catch((error) => {
        this.logger.error('[EventCardChart] Failed to persist xAxisType setting', error);
        this.xAxisTypeOverride = null;
        this.queueRebuild('xAxisType-revert');
      });
  }

  public get extraMaxForPower() {
    return this.userSettingsQuery.chartSettings()?.extraMaxForPower ?? AppUserUtilities.getDefaultExtraMaxForPower();
  }

  public get extraMaxForPace() {
    return this.userSettingsQuery.chartSettings()?.extraMaxForPace ?? AppUserUtilities.getDefaultExtraMaxForPace();
  }

  public get strokeWidth() {
    return this.userSettingsQuery.chartSettings()?.strokeWidth ?? AppUserUtilities.getDefaultChartStrokeWidth();
  }

  public get useAnimations() {
    return this.userSettingsQuery.chartSettings()?.useAnimations === true;
  }

  public get showActivityNamesInTooltip(): boolean {
    const event = this.event as (EventInterface & {
      benchmarkResults?: unknown;
      benchmarkResult?: unknown;
      benchmarkDevices?: unknown[];
    }) | null | undefined;

    return event?.isMerge === true
      || !!event?.benchmarkResults
      || !!event?.benchmarkResult
      || (Array.isArray(event?.benchmarkDevices) && event.benchmarkDevices.length > 0);
  }

  public get userUnitSettings() {
    return this.userSettingsQuery.unitSettings();
  }

  public get visibleDataTypeCount(): number {
    return this.dataTypeLegendItems.filter((item) => item.visible).length;
  }

  public get mobileLegendSummary(): string {
    return `Series ${this.visibleDataTypeCount}/${this.dataTypeLegendItems.length}`;
  }

  public get dataTypesToUse(): string[] {
    return this.user ? this.userService.getUserChartDataTypesToUse(this.user) : [];
  }

  private breakpointObserver = inject(BreakpointObserver);
  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private themeService = inject(AppThemeService);
  private userService = inject(AppUserService);
  private activityCursorService = inject(AppActivityCursorService);
  private chartSettingsLocalStorageService = inject(AppChartSettingsLocalStorageService);
  private eventColorService = inject(AppEventColorService);
  private logger = inject(LoggerService);
  private injector = inject(Injector);
  private cdr = inject(ChangeDetectorRef);

  private themeSignal = toSignal(this.themeService.getChartTheme(), { initialValue: ChartThemes.Material });
  public isMobileLegendMode = toSignal(
    this.breakpointObserver.observe([AppBreakpoints.XSmall]).pipe(map((result) => result.matches)),
    { initialValue: false }
  );
  private cursorPositionSubject = new Subject<number>();
  private cursorPositionSubscription?: Subscription;
  private xAxisTypeOverride: XAxisTypes | null = null;
  private pendingRebuild = false;
  private visibleDataTypeIDs = new Set<string>();
  private visibilityEventID: string | null = null;
  private lastPanelRebuildKey: string | null = null;
  private lastLapMarkersKey: string | null = null;
  private lastPersistedVisibleDataTypeKey: string | null = null;

  constructor() {
    runInInjectionContext(this.injector, () => {
      effect(() => {
        const theme = this.themeSignal();
        this.userSettingsQuery.chartSettings();
        this.userSettingsQuery.unitSettings();

        this.chartTheme = theme ?? ChartThemes.Material;
        this.queueRebuild('settings-effect');
      }, { injector: this.injector });
    });
  }

  ngOnInit(): void {
    this.cursorPositionSubscription = this.cursorPositionSubject.pipe(
      throttleTime(250, asyncScheduler, { leading: true, trailing: true })
    ).subscribe((axisValue) => {
      this.pushCursorToMap(axisValue);
    });

    this.queueRebuild('ngOnInit');
  }

  ngOnChanges(simpleChanges: SimpleChanges): void {
    if (
      simpleChanges.event
      || simpleChanges.selectedActivities
      || simpleChanges.targetUserID
      || simpleChanges.user
    ) {
      this.queueRebuild('ngOnChanges');
    }
  }

  ngOnDestroy(): void {
    this.cursorPositionSubscription?.unsubscribe();
  }

  public onPanelCursorPositionChange(axisValue: number): void {
    this.cursorPositionSubject.next(axisValue);
  }

  public onDataTypeLegendSelectionChange(dataType: string, visible: boolean): void {
    if (!dataType) {
      return;
    }

    if (visible) {
      this.visibleDataTypeIDs.add(dataType);
    } else {
      this.visibleDataTypeIDs.delete(dataType);
    }

    this.applyDataTypeVisibility();
    this.persistVisibleDataTypes();
  }

  public onShowAllDataTypes(): void {
    this.visibleDataTypeIDs = new Set(this.allChartPanels.map((panel) => panel.dataType));
    this.applyDataTypeVisibility();
    this.persistVisibleDataTypes();
  }

  public resolveLegendDotColor(item: EventDataTypeLegendItem): string {
    return item.visible ? item.color : LEGEND_MUTED_DOT_COLOR;
  }

  private queueRebuild(source: string): void {
    if (this.pendingRebuild) {
      return;
    }

    this.pendingRebuild = true;
    Promise.resolve().then(() => {
      this.pendingRebuild = false;
      this.rebuildPanels(source);
    });
  }

  private rebuildPanels(source: string): void {
    const allActivities = this.event?.getActivities?.() || this.selectedActivities || [];
    const selectedActivities = this.selectedActivities || [];
    const effectiveXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType);
    const zoomSyncGroupId = this.resolveZoomSyncGroupID(this.event);
    const panelRebuildKey = this.buildPanelRebuildKey(selectedActivities, allActivities, effectiveXAxisType);
    const lapMarkersKey = this.buildLapMarkersRebuildKey(selectedActivities, allActivities, effectiveXAxisType);
    const shouldRebuildPanels = this.lastPanelRebuildKey !== panelRebuildKey;
    const shouldRebuildLaps = this.lastLapMarkersKey !== lapMarkersKey;

    this.renderedXAxisType = effectiveXAxisType;
    this.zoomSyncGroupId = zoomSyncGroupId;

    if (!shouldRebuildPanels && !shouldRebuildLaps) {
      this.cdr.markForCheck();
      return;
    }

    this.loading();

    try {
      if (shouldRebuildPanels) {
        this.allChartPanels = buildEventChartPanels({
          selectedActivities,
          allActivities,
          xAxisType: effectiveXAxisType,
          showAllData: this.showAllData,
          dataTypesToUse: this.dataTypesToUse,
          userUnitSettings: this.userUnitSettings,
          eventColorService: this.eventColorService,
        });
        this.logDataTypeOrdering(source, this.allChartPanels);
        this.lastPanelRebuildKey = panelRebuildKey;

        this.syncVisibleDataTypes(this.allChartPanels);
        this.applyDataTypeVisibility();
        this.persistVisibleDataTypes();
      }

      if (shouldRebuildLaps) {
        this.lapMarkers = this.showLaps
          ? buildEventLapMarkers({
            selectedActivities,
            allActivities,
            xAxisType: effectiveXAxisType,
            lapTypes: this.lapTypes,
            eventColorService: this.eventColorService,
          })
          : [];
        this.lastLapMarkersKey = lapMarkersKey;
      }

      const globalDomain = this.resolveGlobalDomain(this.allChartPanels);
      this.xDomain = globalDomain;
      this.updateZoomBarOverviewData(globalDomain);
      this.showDateOnTimeAxis = this.resolveShowDateOnTimeAxis(globalDomain, effectiveXAxisType);

      if (source === 'ngOnChanges' && this.chartPanels.length === 0) {
        this.logger.info('[EventCardChart] No panels to render for current selection');
      }
    } catch (error) {
      this.logger.error('[EventCardChart] Failed to rebuild chart panels', error);
      this.allChartPanels = [];
      this.chartPanels = [];
      this.dataTypeLegendItems = [];
      this.lapMarkers = [];
      this.xDomain = null;
      this.zoomBarOverviewData = [];
      this.showDateOnTimeAxis = false;
      this.renderedXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType);
      this.zoomSyncGroupId = this.resolveZoomSyncGroupID(this.event);
      this.lastPanelRebuildKey = null;
      this.lastLapMarkersKey = null;
      this.lastPersistedVisibleDataTypeKey = null;
    } finally {
      this.loaded();
      this.cdr.markForCheck();
    }
  }

  private resolveGlobalDomain(panels: EventChartPanelModel[]): EventChartRange | null {
    if (!panels.length) {
      return null;
    }

    const min = Math.min(...panels.map((panel) => panel.minX));
    const max = Math.max(...panels.map((panel) => panel.maxX));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return null;
    }

    return {
      start: min,
      end: max,
    };
  }

  private resolveShowDateOnTimeAxis(domain: EventChartRange | null, axisType: XAxisTypes): boolean {
    if (axisType !== XAxisTypes.Time || !domain) {
      return false;
    }

    const startDate = new Date(domain.start);
    const endDate = new Date(domain.end);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
      return false;
    }

    return startDate.getFullYear() !== endDate.getFullYear()
      || startDate.getMonth() !== endDate.getMonth()
      || startDate.getDate() !== endDate.getDate();
  }

  private syncVisibleDataTypes(panels: EventChartPanelModel[]): void {
    const eventID = this.event?.getID?.() || null;
    if (this.visibilityEventID !== eventID) {
      this.visibilityEventID = eventID;
      this.visibleDataTypeIDs.clear();
      this.lastPersistedVisibleDataTypeKey = null;
    }

    const availableDataTypeIDs = new Set(panels.map((panel) => panel.dataType));
    if (!availableDataTypeIDs.size) {
      this.visibleDataTypeIDs.clear();
      return;
    }

    let nextVisibleDataTypeIDs = new Set<string>();

    if (this.visibleDataTypeIDs.size > 0) {
      this.visibleDataTypeIDs.forEach((dataTypeID) => {
        if (availableDataTypeIDs.has(dataTypeID)) {
          nextVisibleDataTypeIDs.add(dataTypeID);
        }
      });
    }

    if (nextVisibleDataTypeIDs.size === 0) {
      this.getPersistedVisibleDataTypeIDs().forEach((dataTypeID) => {
        if (availableDataTypeIDs.has(dataTypeID)) {
          nextVisibleDataTypeIDs.add(dataTypeID);
        }
      });
    }

    if (nextVisibleDataTypeIDs.size === 0) {
      nextVisibleDataTypeIDs = new Set(availableDataTypeIDs);
    }

    this.visibleDataTypeIDs = nextVisibleDataTypeIDs;
  }

  private applyDataTypeVisibility(): void {
    const visibleDataTypeIDs = this.visibleDataTypeIDs;
    this.chartPanels = this.allChartPanels.filter((panel) => visibleDataTypeIDs.has(panel.dataType));
    this.dataTypeLegendItems = this.allChartPanels.map((panel) => ({
      dataType: panel.dataType,
      label: panel.displayName,
      color: visibleDataTypeIDs.has(panel.dataType)
        ? resolveEventSeriesColor(panel.colorGroupKey, 0, 1)
        : LEGEND_MUTED_DOT_COLOR,
      visible: visibleDataTypeIDs.has(panel.dataType),
    }));
    this.updateZoomBarOverviewData();
  }

  private updateZoomBarOverviewData(domain: EventChartRange | null = this.xDomain ?? this.resolveGlobalDomain(this.allChartPanels)): void {
    this.zoomBarOverviewData = buildEventZoomOverviewData(this.chartPanels, domain);
  }

  private getPersistedVisibleDataTypeIDs(): string[] {
    if (!this.event?.getID?.()) {
      return [];
    }
    return this.chartSettingsLocalStorageService
      .getDataTypeIDsToShow(this.event)
      .filter((dataTypeID) => !!dataTypeID);
  }

  private persistVisibleDataTypes(): void {
    const eventID = this.event?.getID?.();
    if (!eventID) {
      return;
    }
    const sortedDataTypeIDs = [...this.visibleDataTypeIDs].sort((left, right) => left.localeCompare(right));
    const persistenceKey = `${eventID}|${sortedDataTypeIDs.join(',')}`;
    if (this.lastPersistedVisibleDataTypeKey === persistenceKey) {
      return;
    }

    this.chartSettingsLocalStorageService.setDataTypeIDsToShow(
      this.event,
      sortedDataTypeIDs,
    );
    this.lastPersistedVisibleDataTypeKey = persistenceKey;
  }

  private buildPanelRebuildKey(
    selectedActivities: ActivityInterface[],
    allActivities: ActivityInterface[],
    xAxisType: XAxisTypes
  ): string {
    const eventID = this.event?.getID?.() || '';
    const selectedActivityKey = this.buildActivitiesKey(selectedActivities);
    const allActivitiesKey = this.buildActivitiesKey(allActivities);
    const dataTypesKey = [...(this.dataTypesToUse || [])].sort((left, right) => left.localeCompare(right)).join(',');
    const unitSettingsKey = this.buildUnitSettingsKey(this.userUnitSettings);

    return [
      eventID,
      `${xAxisType}`,
      this.showAllData ? '1' : '0',
      selectedActivityKey,
      allActivitiesKey,
      dataTypesKey,
      unitSettingsKey,
    ].join('|');
  }

  private logDataTypeOrdering(source: string, panels: EventChartPanelModel[]): void {
    const userUnitSettings = this.userUnitSettings;
    const selectedDataTypes = [...(this.dataTypesToUse || [])];
    const unitDerivedVariants = selectedDataTypes.map((dataType) => ({
      dataType,
      variants: DynamicDataLoader.getUnitBasedDataTypesFromDataTypes(
        [dataType],
        userUnitSettings,
        { includeDerivedTypes: true }
      ),
    }));

    this.logger.info('[EventCardChart] Data type ordering', {
      source,
      selectedDataTypes,
      unitDerivedVariants,
      chartPanelOrder: panels.map((panel) => ({
        dataType: panel.dataType,
        displayName: panel.displayName,
      })),
    });
  }

  private buildLapMarkersRebuildKey(
    selectedActivities: ActivityInterface[],
    allActivities: ActivityInterface[],
    xAxisType: XAxisTypes
  ): string {
    const eventID = this.event?.getID?.() || '';
    if (!this.showLaps) {
      return `${eventID}|hidden`;
    }

    const selectedActivityKey = this.buildActivitiesKey(selectedActivities);
    const allActivitiesKey = this.buildActivitiesKey(allActivities);
    const lapTypesKey = [...this.lapTypes]
      .map((lapType) => `${lapType}`)
      .sort((left, right) => left.localeCompare(right))
      .join(',');

    return [
      eventID,
      `${xAxisType}`,
      selectedActivityKey,
      allActivitiesKey,
      lapTypesKey,
    ].join('|');
  }

  private buildActivitiesKey(activities: ActivityInterface[]): string {
    return (activities || [])
      .map((activity) => `${activity?.getID?.() || ''}`)
      .join(',');
  }

  private buildUnitSettingsKey(unitSettings: unknown): string {
    if (!unitSettings || typeof unitSettings !== 'object') {
      return '';
    }

    const normalizedEntries = Object.entries(unitSettings as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, this.normalizeRebuildKeyValue(value)]);

    return JSON.stringify(normalizedEntries);
  }

  private normalizeRebuildKeyValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeRebuildKeyValue(entry)).join(',');
    }

    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object]';
      }
    }

    return `${value ?? ''}`;
  }

  private resolveZoomSyncGroupID(event: EventInterface | null | undefined): string | null {
    const eventID = event?.getID?.();
    if (!eventID) {
      return null;
    }
    return `event-chart-zoom-${eventID}`;
  }

  private pushCursorToMap(axisValue: number): void {
    if (!Number.isFinite(axisValue)) {
      return;
    }

    const effectiveXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType);

    this.selectedActivities.forEach((activity) => {
      const activityID = activity.getID() || '';
      if (!activityID) {
        return;
      }

      let cursorTime: number | null = null;
      switch (effectiveXAxisType) {
        case XAxisTypes.Time:
          cursorTime = axisValue;
          break;
        case XAxisTypes.Duration:
          cursorTime = activity.startDate.getTime() + axisValue * 1000;
          break;
        case XAxisTypes.Distance:
          cursorTime = this.resolveDistanceCursorTime(activity, axisValue);
          break;
        default:
          cursorTime = null;
      }

      if (!Number.isFinite(cursorTime)) {
        return;
      }

      this.activityCursorService.setCursor({
        activityID,
        time: cursorTime as number,
        byChart: true,
      });
    });
  }

  private resolveDistanceCursorTime(activity: ActivityInterface, targetDistance: number): number | null {
    const distanceStream = activity.getStream(DataDistance.type) || activity.getStream(DataStrydDistance.type);
    const timeStream = activity.getStream(XAxisTypes.Time);
    const distanceValues = this.toNumericArray(distanceStream?.getData());
    const timeValues = this.toNumericArray(timeStream?.getData());

    const length = Math.min(distanceValues.length, timeValues.length);
    if (!length) {
      return null;
    }

    let closestIndex = 0;
    let smallestDelta = Number.POSITIVE_INFINITY;

    for (let index = 0; index < length; index += 1) {
      const delta = Math.abs(targetDistance - distanceValues[index]);
      if (delta < smallestDelta) {
        smallestDelta = delta;
        closestIndex = index;
      }
    }

    const seconds = timeValues[closestIndex];
    if (!Number.isFinite(seconds)) {
      return null;
    }

    return activity.startDate.getTime() + seconds * 1000;
  }

  private toNumericArray(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => Number(item));
  }

  private loading(): void {
    this.isLoading = true;
    this.loadingStatus.emit(true);
    this.cdr.markForCheck();
  }

  private loaded(): void {
    this.isLoading = false;
    this.loadingStatus.emit(false);
    this.cdr.markForCheck();
  }
}
