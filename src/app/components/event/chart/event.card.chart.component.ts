import {
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { throttleTime } from 'rxjs/operators';
import { Subject, asyncScheduler } from 'rxjs';
import {
  ActivityInterface,
  ChartCursorBehaviours,
  DataDistance,
  DataStrydDistance,
  EventInterface,
  LapTypes,
  User,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { AppChartSettingsLocalStorageService } from '../../../services/storage/app.chart.settings.local.storage.service';
import { LoggerService } from '../../../services/logger.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import {
  buildEventChartPanels,
  buildEventLapMarkers,
  buildEventZoomOverviewData,
  EventChartLapMarker,
  EventChartPanelModel,
} from '../../../helpers/event-echarts-data.helper';
import { resolveEventSeriesColor } from '../../../helpers/event-echarts-style.helper';
import {
  clampEventRange,
  EventChartRange,
  normalizeEventRange,
  resolveEventChartXAxisType,
} from '../../../helpers/event-echarts-xaxis.helper';
import { isMergeOrBenchmarkEvent } from '../../../helpers/event-visibility.helper';

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
  @Input() darkTheme = false;

  @Output() loadingStatus = new EventEmitter<boolean>();

  public isLoading = false;
  public allChartPanels: EventChartPanelModel[] = [];
  public chartPanels: EventChartPanelModel[] = [];
  public dataTypeLegendItems: EventDataTypeLegendItem[] = [];
  public lapMarkers: EventChartLapMarker[] = [];
  public xDomain: EventChartRange | null = null;
  public zoomBarOverviewData: Array<[number, number]> = [];
  public renderedXAxisType: XAxisTypes = XAxisTypes.Duration;
  public showDateOnTimeAxis = false;
  public zoomRange: EventChartRange | null = null;
  public previewSelectedRange: EventChartRange | null = null;
  public selectedRange: EventChartRange | null = null;

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

  public get cursorBehaviour() {
    return this.cursorBehaviourOverride
      ?? this.userSettingsQuery.chartSettings()?.chartCursorBehaviour
      ?? AppUserUtilities.getDefaultChartCursorBehaviour();
  }
  public set cursorBehaviour(value: ChartCursorBehaviours) {
    if (value === this.cursorBehaviour) {
      return;
    }

    this.cursorBehaviourOverride = value;
    this.cdr.markForCheck();

    void this.userSettingsQuery.updateChartSettings({ chartCursorBehaviour: value })
      .then(() => {
        this.cursorBehaviourOverride = null;
        this.cdr.markForCheck();
      })
      .catch((error) => {
        this.logger.error('[EventCardChart] Failed to persist chartCursorBehaviour setting', error);
        this.cursorBehaviourOverride = null;
        this.cdr.markForCheck();
      });
  }

  public get syncChartHoverToMap(): boolean {
    return this.syncChartHoverToMapOverride
      ?? this.userSettingsQuery.chartSettings()?.syncChartHoverToMap
      ?? AppUserUtilities.getDefaultSyncChartHoverToMap();
  }
  public set syncChartHoverToMap(value: boolean) {
    if (value === this.syncChartHoverToMap) {
      return;
    }

    this.syncChartHoverToMapOverride = value;
    this.cdr.markForCheck();

    void this.userSettingsQuery.updateChartSettings({ syncChartHoverToMap: value })
      .then(() => {
        this.syncChartHoverToMapOverride = null;
        this.cdr.markForCheck();
      })
      .catch((error) => {
        this.logger.error('[EventCardChart] Failed to persist syncChartHoverToMap setting', error);
        this.syncChartHoverToMapOverride = null;
        this.cdr.markForCheck();
      });
  }

  public get gainAndLossThreshold() {
    return this.userSettingsQuery.chartSettings()?.gainAndLossThreshold ?? AppUserUtilities.getDefaultGainAndLossThreshold();
  }

  public get fillOpacity() {
    return this.fillOpacityOverride
      ?? AppUserUtilities.getResolvedChartFillOpacity(this.userSettingsQuery.chartSettings());
  }
  public set fillOpacity(value: number) {
    const normalizedValue = Math.min(1, Math.max(0, Number(value)));
    const nextValue = Number.isFinite(normalizedValue)
      ? normalizedValue
      : AppUserUtilities.getDefaultChartFillOpacity();
    if (Math.abs(nextValue - this.fillOpacity) < 0.0001) {
      return;
    }

    this.fillOpacityOverride = nextValue;
    this.cdr.markForCheck();
    this.scheduleFillOpacityPersist(nextValue);
  }

  public get strokeWidth() {
    return this.userSettingsQuery.chartSettings()?.strokeWidth ?? AppUserUtilities.getDefaultChartStrokeWidth();
  }

  public get useAnimations() {
    return this.userSettingsQuery.chartSettings()?.useAnimations === true;
  }

  public get showActivityNamesInTooltip(): boolean {
    return isMergeOrBenchmarkEvent(this.event);
  }

  public get userUnitSettings() {
    return this.userSettingsQuery.unitSettings();
  }

  public get visibleDataTypeCount(): number {
    return this.dataTypeLegendItems.filter((item) => item.visible).length;
  }

  public get seriesMenuSummary(): string {
    return `Series ${this.visibleDataTypeCount}/${this.dataTypeLegendItems.length}`;
  }

  public get hasActiveZoomRange(): boolean {
    return this.zoomRange !== null;
  }

  public get hasActiveSelectionRange(): boolean {
    return normalizeEventRange(this.previewSelectedRange ?? this.selectedRange) !== null;
  }

  public get hasResettableChartState(): boolean {
    return this.hasActiveZoomRange || this.hasActiveSelectionRange;
  }

  public get hasWaterMark(): boolean {
    return this.waterMarkText.length > 0;
  }

  public get waterMarkText(): string {
    return `${this.waterMark || ''}`.trim();
  }

  public get dataTypesToUse(): string[] {
    return this.user ? this.userService.getUserChartDataTypesToUse(this.user) : [];
  }

  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private userService = inject(AppUserService);
  private activityCursorService = inject(AppActivityCursorService);
  private chartSettingsLocalStorageService = inject(AppChartSettingsLocalStorageService);
  private eventColorService = inject(AppEventColorService);
  private logger = inject(LoggerService);
  private injector = inject(Injector);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  private cursorPositionSubject = new Subject<number>();
  private xAxisTypeOverride: XAxisTypes | null = null;
  private cursorBehaviourOverride: ChartCursorBehaviours | null = null;
  private syncChartHoverToMapOverride: boolean | null = null;
  private fillOpacityOverride: number | null = null;
  private fillOpacityPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRebuild = false;
  private visibleDataTypeIDs = new Set<string>();
  private visibilityEventID: string | null = null;
  private lastPanelRebuildKey: string | null = null;
  private lastLapMarkersKey: string | null = null;
  private lastPersistedVisibleDataTypeKey: string | null = null;
  private zoomRangeOwnerEventID: string | null = null;

  constructor() {
    runInInjectionContext(this.injector, () => {
      effect(() => {
        const chartSettings = this.userSettingsQuery.chartSettings();
        this.userSettingsQuery.unitSettings();
        if (
          this.fillOpacityOverride !== null
          && Math.abs(AppUserUtilities.getResolvedChartFillOpacity(chartSettings) - this.fillOpacityOverride) < 0.0001
        ) {
          this.fillOpacityOverride = null;
          this.cdr.markForCheck();
        }
        this.queueRebuild('settings-effect');
      }, { injector: this.injector });
    });
  }

  ngOnInit(): void {
    this.cursorPositionSubject.pipe(
      throttleTime(250, asyncScheduler, { leading: true, trailing: true }),
      takeUntilDestroyed(this.destroyRef)
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
      || simpleChanges.darkTheme
    ) {
      this.queueRebuild('ngOnChanges');
    }
  }

  ngOnDestroy(): void {
    if (this.fillOpacityPersistTimer !== null) {
      clearTimeout(this.fillOpacityPersistTimer);
      this.fillOpacityPersistTimer = null;
    }
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

  public onSelectedRangeChange(range: EventChartRange | null): void {
    const domain = this.xDomain;
    if (!domain) {
      this.previewSelectedRange = null;
      this.selectedRange = null;
      this.cdr.markForCheck();
      return;
    }

    const nextRange = range ? clampEventRange(range, domain.start, domain.end) : null;
    const currentRange = this.selectedRange;
    if (
      currentRange?.start === nextRange?.start
      && currentRange?.end === nextRange?.end
    ) {
      return;
    }

    this.previewSelectedRange = nextRange;
    this.selectedRange = nextRange;
    this.cdr.markForCheck();
  }

  public onPreviewSelectedRangeChange(range: EventChartRange | null): void {
    const domain = this.xDomain;
    if (!domain) {
      this.previewSelectedRange = null;
      this.cdr.markForCheck();
      return;
    }

    const nextRange = range ? clampEventRange(range, domain.start, domain.end) : null;
    const currentRange = this.previewSelectedRange;
    if (
      currentRange?.start === nextRange?.start
      && currentRange?.end === nextRange?.end
    ) {
      return;
    }

    this.previewSelectedRange = nextRange;
    this.cdr.markForCheck();
  }

  public onZoomRangeChange(range: EventChartRange | null): void {
    const nextRange = this.normalizeZoomRange(range, this.xDomain);
    const currentRange = this.zoomRange;
    if (
      currentRange?.start === nextRange?.start
      && currentRange?.end === nextRange?.end
    ) {
      return;
    }

    this.zoomRange = nextRange;
    this.cdr.markForCheck();
  }

  public onResetChartStateRequested(): void {
    if (this.zoomRange === null && this.previewSelectedRange === null && this.selectedRange === null) {
      return;
    }

    this.zoomRange = null;
    this.previewSelectedRange = null;
    this.selectedRange = null;
    this.cdr.markForCheck();
  }

  private scheduleFillOpacityPersist(value: number): void {
    if (this.fillOpacityPersistTimer !== null) {
      clearTimeout(this.fillOpacityPersistTimer);
    }

    this.fillOpacityPersistTimer = setTimeout(() => {
      this.fillOpacityPersistTimer = null;
      void this.userSettingsQuery.updateChartSettings({ fillOpacity: value, fillOpacityVersion: 1 })
        .catch((error) => this.logger.error('[EventCardChart] Failed to persist fillOpacity', error));
    }, 180);
  }

  private queueRebuild(source: string): void {
    if (this.pendingRebuild) {
      return;
    }

    this.pendingRebuild = true;
    void Promise.resolve()
      .then(() => {
        this.pendingRebuild = false;
        this.rebuildPanels(source);
      })
      .catch((error) => {
        this.pendingRebuild = false;
        this.logger.error('[EventCardChart] Failed to queue panel rebuild', error);
      });
  }

  private rebuildPanels(source: string): void {
    const allActivities = this.event?.getActivities?.() || this.selectedActivities || [];
    const selectedActivities = this.selectedActivities || [];
    const effectiveXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType);
    const nextEventID = this.event?.getID?.() || null;
    const panelRebuildKey = this.buildPanelRebuildKey(selectedActivities, allActivities, effectiveXAxisType);
    const lapMarkersKey = this.buildLapMarkersRebuildKey(selectedActivities, allActivities, effectiveXAxisType);
    const shouldRebuildPanels = this.lastPanelRebuildKey !== panelRebuildKey;
    const shouldRebuildLaps = this.lastLapMarkersKey !== lapMarkersKey;

    const previousZoomRangeOwnerEventID = this.zoomRangeOwnerEventID;
    this.renderedXAxisType = effectiveXAxisType;
    this.zoomRangeOwnerEventID = nextEventID;

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
      this.zoomRange = previousZoomRangeOwnerEventID !== this.zoomRangeOwnerEventID
        ? null
        : this.normalizeZoomRange(this.zoomRange, globalDomain);
      this.updateZoomBarOverviewData(globalDomain);
      this.showDateOnTimeAxis = this.resolveShowDateOnTimeAxis(globalDomain, effectiveXAxisType);
    } catch (error) {
      this.logger.error('[EventCardChart] Failed to rebuild chart panels', error);
      this.allChartPanels = [];
      this.chartPanels = [];
      this.dataTypeLegendItems = [];
      this.lapMarkers = [];
      this.xDomain = null;
      this.zoomRange = null;
      this.zoomBarOverviewData = [];
      this.showDateOnTimeAxis = false;
      this.renderedXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType);
      this.zoomRangeOwnerEventID = this.event?.getID?.() || null;
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

  private normalizeZoomRange(range: EventChartRange | null, domain: EventChartRange | null): EventChartRange | null {
    if (!domain) {
      return null;
    }

    const clampedRange = range ? clampEventRange(range, domain.start, domain.end) : null;
    if (!clampedRange) {
      return null;
    }

    return clampedRange.start === domain.start && clampedRange.end === domain.end
      ? null
      : clampedRange;
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
