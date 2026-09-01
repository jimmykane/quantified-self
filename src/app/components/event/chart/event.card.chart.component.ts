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
  signal,
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
  type StreamInterface,
  User,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import {
  AppChartSettingsLocalStorageService,
  EventChartVisibilityMode,
} from '../../../services/storage/app.chart.settings.local.storage.service';
import { LoggerService } from '../../../services/logger.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import {
  buildEventChartPanels,
  buildEventLapMarkers,
  buildEventSwimLengthMarkers,
  buildEventZoomOverviewData,
  createEventChartPanelBuildSnapshot,
  EVENT_CHART_INTENSITY_ZONE_LINE_DATA_TYPES,
  EVENT_CHART_INTENSITY_ZONE_LOWER_LIMIT_KEYS,
  EventChartLapMarker,
  EventChartPanelModel,
  EventChartSwimLengthMarker,
  resolveEventChartConfiguredDataTypes,
} from '../../../helpers/event-echarts-data.helper';
import { resolveEventSeriesColor } from '../../../helpers/event-echarts-style.helper';
import {
  canSelectEventChartDistanceXAxis,
  clampEventRange,
  EventChartRange,
  normalizeEventRange,
  resolveEventChartXAxisType,
} from '../../../helpers/event-echarts-xaxis.helper';
import { isMergeOrBenchmarkEvent } from '../../../helpers/event-visibility.helper';
import {
  areEventChartOverlayMapsEqual,
  normalizeEventChartOverlayDataTypeByPrimary,
} from '../../../helpers/event-chart-overlay.helper';
import type { EventChartOverlayOption } from '../../../helpers/event-chart-overlay.helper';
import { hasVisibleSwimLengths } from '../../../helpers/event-swim-length.helper';
import { EventChartPanelWorkerService } from '../../../services/event-chart-panel-worker.service';
import {
  EventChartSportProfileResolution,
  getEventChartSelectionKey,
  resolveEventChartRecommendations,
  resolveEventChartSportProfile,
} from '../../../helpers/event-chart-sport-profile.helper';

interface EventDataTypeLegendItem {
  dataType: string;
  label: string;
  color: string;
  visible: boolean;
}

interface EventChartPanelViewModel {
  panel: EventChartPanelModel;
  overlayPanel: EventChartPanelModel | null;
  overlayOptions: EventChartOverlayOption[];
  selectedOverlayDataType: string | null;
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
  @Input() automaticExcludedDataTypes: string[] = [];
  @Input() isVisible!: boolean;
  @Input() waterMark?: string;
  @Input() darkTheme = false;

  @Output() loadingStatus = new EventEmitter<boolean>();

  public isLoading = false;
  public allChartPanels: EventChartPanelModel[] = [];
  public chartPanels: EventChartPanelModel[] = [];
  public chartPanelViews: EventChartPanelViewModel[] = [];
  public dataTypeLegendItems: EventDataTypeLegendItem[] = [];
  public recommendedDataTypeLegendItems: EventDataTypeLegendItem[] = [];
  public otherDataTypeLegendItems: EventDataTypeLegendItem[] = [];
  public visibilityMode: EventChartVisibilityMode = 'automatic';
  public sportProfile: EventChartSportProfileResolution = resolveEventChartSportProfile([]);
  public visibilityAnnouncement = signal('');
  public lapMarkers: EventChartLapMarker[] = [];
  public swimLengthMarkers: EventChartSwimLengthMarker[] = [];
  public hasSelectedSwimLengths = false;
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

  public get showSwimLengths() { return this.userSettingsQuery.chartSettings()?.showSwimLengths ?? true; }
  public set showSwimLengths(value: boolean) {
    if (value !== this.showSwimLengths) {
      void this.userSettingsQuery.updateChartSettings({ showSwimLengths: value })
        .then(() => this.queueRebuild('showSwimLengths'))
        .catch((error) => this.logger.error('[EventCardChart] Failed to persist showSwimLengths', error));
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

  public get displayedXAxisType(): XAxisTypes {
    return resolveEventChartXAxisType(this.event, this.xAxisType, this.selectedActivities);
  }

  public get canSelectDistanceXAxis(): boolean {
    return canSelectEventChartDistanceXAxis(this.selectedActivities);
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
    this.queueCursorBehaviourPersist(value);
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

  public get colorAltitudeByGrade(): boolean {
    return this.colorAltitudeByGradeOverride
      ?? (this.userSettingsQuery.chartSettings()?.colorAltitudeByGrade !== false);
  }
  public set colorAltitudeByGrade(value: boolean) {
    if (value === this.colorAltitudeByGrade) {
      return;
    }

    this.colorAltitudeByGradeOverride = value;
    this.cdr.markForCheck();

    void this.userSettingsQuery.updateChartSettings({ colorAltitudeByGrade: value })
      .then(() => {
        this.colorAltitudeByGradeOverride = null;
        this.cdr.markForCheck();
      })
      .catch((error) => {
        this.logger.error('[EventCardChart] Failed to persist colorAltitudeByGrade setting', error);
        this.colorAltitudeByGradeOverride = null;
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

  public get allRecordedMetricsForced(): boolean {
    return isMergeOrBenchmarkEvent(this.event);
  }

  public get effectiveShowAllData(): boolean {
    return this.allRecordedMetricsForced || this.showAllData;
  }

  public get resetToSportDefaultsLabel(): string {
    return this.sportProfile.usesGenericResetLabel
      ? 'Reset to recommended defaults'
      : `Reset to ${this.sportProfile.label} defaults`;
  }

  public get userUnitSettings() {
    return this.userSettingsQuery.unitSettings();
  }

  public get visibleDataTypeCount(): number {
    return this.dataTypeLegendItems.filter((item) => item.visible).length;
  }

  public get seriesMenuSummary(): string {
    return `Visible charts: ${this.visibleDataTypeCount}/${this.dataTypeLegendItems.length}`;
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

  public get hasAltitudeGradeColorData(): boolean {
    return this.allChartPanels.some((panel) =>
      panel.series.some((series) => !!series.gradeColorValues?.length)
    );
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
  private eventChartPanelWorkerService = inject(EventChartPanelWorkerService);
  private logger = inject(LoggerService);
  private injector = inject(Injector);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  private cursorPositionSubject = new Subject<number>();
  private xAxisTypeOverride: XAxisTypes | null = null;
  private cursorBehaviourOverride: ChartCursorBehaviours | null = null;
  private cursorBehaviourPersistRequestID = 0;
  private cursorBehaviourConfirmedRequestID = 0;
  private cursorBehaviourPersistQueue: Promise<void> = Promise.resolve();
  private syncChartHoverToMapOverride: boolean | null = null;
  private colorAltitudeByGradeOverride: boolean | null = null;
  private fillOpacityOverride: number | null = null;
  private eventChartOverlayDataTypeByPrimaryOverride: Record<string, string> | null = null;
  private eventChartOverlayPersistRequestID = 0;
  private eventChartOverlayPersistQueue: Promise<void> = Promise.resolve();
  private fillOpacityPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRebuild = false;
  private panelBuildRequestID = 0;
  private visibleDataTypeIDs = new Set<string>();
  private customSelectionKeys = new Set<string>();
  private automaticDataTypeIDs: string[] = [];
  private recommendedDataTypeOrder: string[] = [];
  private visibilityOwnerKey: string | null = null;
  private lastPanelRebuildKey: string | null = null;
  private lastLapMarkersKey: string | null = null;
  private lastSwimLengthMarkersKey: string | null = null;
  private lastPersistedCustomVisibilityKey: string | null = null;
  private zoomRangeOwnerEventID: string | null = null;

  constructor() {
    effect(() => {
      const chartSettings = this.userSettingsQuery.chartSettings();
      this.userSettingsQuery.unitSettings();
      if (
        this.cursorBehaviourOverride !== null
        && this.cursorBehaviourConfirmedRequestID === this.cursorBehaviourPersistRequestID
        && chartSettings?.chartCursorBehaviour === this.cursorBehaviourOverride
      ) {
        this.cursorBehaviourOverride = null;
        this.cdr.markForCheck();
      }
      if (
        this.eventChartOverlayDataTypeByPrimaryOverride !== null
        && areEventChartOverlayMapsEqual(
          this.eventChartOverlayDataTypeByPrimaryOverride,
          chartSettings?.eventChartOverlayDataTypeByPrimary
        )
      ) {
        this.eventChartOverlayDataTypeByPrimaryOverride = null;
      }
      if (
        this.fillOpacityOverride !== null
        && Math.abs(AppUserUtilities.getResolvedChartFillOpacity(chartSettings) - this.fillOpacityOverride) < 0.0001
      ) {
        this.fillOpacityOverride = null;
        this.cdr.markForCheck();
      }
      if (
        this.colorAltitudeByGradeOverride !== null
        && (chartSettings?.colorAltitudeByGrade !== false) === this.colorAltitudeByGradeOverride
      ) {
        this.colorAltitudeByGradeOverride = null;
        this.cdr.markForCheck();
      }
      this.queueRebuild('settings-effect');
    }, { injector: this.injector });
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
      || simpleChanges.automaticExcludedDataTypes
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

  public onXAxisTypeChange(value: XAxisTypes): void {
    this.xAxisType = value;
  }

  public onDataTypeLegendSelectionChange(dataType: string, visible: boolean): void {
    if (!dataType) {
      return;
    }

    const wasVisible = this.visibleDataTypeIDs.has(dataType);
    if (wasVisible === visible) {
      return;
    }

    if (visible) {
      this.visibleDataTypeIDs.add(dataType);
    } else {
      this.visibleDataTypeIDs.delete(dataType);
    }

    this.customSelectionKeys = new Set(
      [...this.visibleDataTypeIDs].map(getEventChartSelectionKey),
    );
    this.visibilityMode = 'custom';
    this.applyDataTypeVisibility();
    this.persistCustomVisibleDataTypes();
    const itemLabel = this.dataTypeLegendItems.find((item) => item.dataType === dataType)?.label || dataType;
    this.visibilityAnnouncement.set(`${itemLabel} chart ${visible ? 'shown' : 'hidden'}. Custom visibility is active.`);
  }

  public onShowAllDataTypes(): void {
    this.visibleDataTypeIDs = new Set(this.allChartPanels.map((panel) => panel.dataType));
    this.customSelectionKeys = new Set(
      [...this.visibleDataTypeIDs].map(getEventChartSelectionKey),
    );
    this.visibilityMode = 'custom';
    this.applyDataTypeVisibility();
    this.persistCustomVisibleDataTypes();
    this.visibilityAnnouncement.set(`All ${this.allChartPanels.length} available charts shown. Custom visibility is active.`);
  }

  public onResetToSportDefaults(): void {
    if (!this.event?.getID?.() || !this.sportProfile.signature) {
      return;
    }

    this.chartSettingsLocalStorageService.resetEventChartVisibilityPreference(
      this.event,
      this.sportProfile.signature,
    );
    this.visibilityMode = 'automatic';
    this.visibleDataTypeIDs = new Set(this.automaticDataTypeIDs);
    this.customSelectionKeys.clear();
    this.lastPersistedCustomVisibilityKey = null;
    this.applyDataTypeVisibility();
    this.visibilityAnnouncement.set(
      `${this.resetToSportDefaultsLabel}. ${this.visibleDataTypeIDs.size} charts visible.`,
    );
  }

  public onPanelOverlayDataTypeChange(primaryDataType: string, overlayDataType: string | null): void {
    const primary = `${primaryDataType || ''}`.trim();
    const overlay = typeof overlayDataType === 'string' ? overlayDataType.trim() : '';
    if (!primary || !this.user) {
      return;
    }

    const nextOverlayMap = {
      ...this.getEventChartOverlayDataTypeByPrimary(),
    };

    if (overlay && overlay !== primary) {
      nextOverlayMap[primary] = overlay;
    } else {
      delete nextOverlayMap[primary];
    }

    const normalizedOverlayMap = normalizeEventChartOverlayDataTypeByPrimary(nextOverlayMap);
    if (areEventChartOverlayMapsEqual(normalizedOverlayMap, this.getEventChartOverlayDataTypeByPrimary())) {
      return;
    }

    this.eventChartOverlayDataTypeByPrimaryOverride = normalizedOverlayMap;
    this.applyDataTypeVisibility();
    this.cdr.markForCheck();

    this.queueEventChartOverlayPersist(normalizedOverlayMap);
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
      .then(async () => {
        this.pendingRebuild = false;
        await this.rebuildPanels(source);
      })
      .catch((error) => {
        this.pendingRebuild = false;
        this.logger.error('[EventCardChart] Failed to queue panel rebuild', error);
      });
  }

  private async rebuildPanels(_source: string): Promise<void> {
    const allActivities = this.event?.getActivities?.() || this.selectedActivities || [];
    const selectedActivities = this.selectedActivities || [];
    const effectiveXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType, selectedActivities);
    const nextEventID = this.event?.getID?.() || null;
    const hasSelectedSwimLengths = hasVisibleSwimLengths(selectedActivities);
    const panelRebuildKey = this.buildPanelRebuildKey(selectedActivities, allActivities, effectiveXAxisType);
    const lapMarkersKey = this.buildLapMarkersRebuildKey(selectedActivities, allActivities, effectiveXAxisType);
    const swimLengthMarkersKey = this.buildSwimLengthMarkersRebuildKey(
      selectedActivities,
      allActivities,
      effectiveXAxisType,
      hasSelectedSwimLengths
    );
    const shouldRebuildPanels = this.lastPanelRebuildKey !== panelRebuildKey;
    const shouldRebuildLaps = this.lastLapMarkersKey !== lapMarkersKey;
    const shouldRebuildSwimLengths = this.lastSwimLengthMarkersKey !== swimLengthMarkersKey;

    const previousZoomRangeOwnerEventID = this.zoomRangeOwnerEventID;
    this.hasSelectedSwimLengths = hasSelectedSwimLengths;
    this.renderedXAxisType = effectiveXAxisType;
    this.zoomRangeOwnerEventID = nextEventID;

    if (!shouldRebuildPanels && !shouldRebuildLaps && !shouldRebuildSwimLengths) {
      this.applyDataTypeVisibility();
      this.cdr.markForCheck();
      return;
    }

    const rebuildRequestID = this.panelBuildRequestID + 1;
    this.panelBuildRequestID = rebuildRequestID;
    this.loading();

    try {
      if (shouldRebuildPanels) {
        const panelBuildInput = {
          selectedActivities,
          allActivities,
          xAxisType: effectiveXAxisType,
          showAllData: this.effectiveShowAllData,
          dataTypesToUse: this.dataTypesToUse,
          userUnitSettings: this.userUnitSettings,
          eventColorService: this.eventColorService,
          colorIntensityZoneLines: this.shouldColorIntensityZoneLines(),
        };
        const nextChartPanels = this.eventChartPanelWorkerService.shouldUseWorker()
          ? await this.eventChartPanelWorkerService.buildPanels(
            createEventChartPanelBuildSnapshot(panelBuildInput),
            () => buildEventChartPanels(panelBuildInput)
          )
          : buildEventChartPanels(panelBuildInput);
        if (rebuildRequestID !== this.panelBuildRequestID) {
          return;
        }

        this.allChartPanels = nextChartPanels;
        this.lastPanelRebuildKey = panelRebuildKey;

        this.syncVisibleDataTypes(this.allChartPanels);
        this.applyDataTypeVisibility();
      }

      if (shouldRebuildLaps) {
        this.lapMarkers = this.showLaps
          ? buildEventLapMarkers({
            selectedActivities,
            allActivities,
            xAxisType: effectiveXAxisType,
            lapTypes: this.lapTypes,
            eventColorService: this.eventColorService,
            userUnitSettings: this.userUnitSettings,
          })
          : [];
        this.lastLapMarkersKey = lapMarkersKey;
      }

      if (shouldRebuildSwimLengths) {
        this.swimLengthMarkers = this.showSwimLengths && hasSelectedSwimLengths
          ? buildEventSwimLengthMarkers({
            selectedActivities,
            allActivities,
            xAxisType: effectiveXAxisType,
            eventColorService: this.eventColorService,
            userUnitSettings: this.userUnitSettings,
          })
          : [];
        this.lastSwimLengthMarkersKey = swimLengthMarkersKey;
      }

      const globalDomain = this.resolveGlobalDomain(this.allChartPanels);
      this.xDomain = globalDomain;
      this.zoomRange = previousZoomRangeOwnerEventID !== this.zoomRangeOwnerEventID
        ? null
        : this.normalizeZoomRange(this.zoomRange, globalDomain);
      this.updateZoomBarOverviewData(globalDomain);
      this.showDateOnTimeAxis = this.resolveShowDateOnTimeAxis(globalDomain, effectiveXAxisType);
    } catch (error) {
      if (rebuildRequestID !== this.panelBuildRequestID) {
        return;
      }

      this.logger.error('[EventCardChart] Failed to rebuild chart panels', error);
      this.allChartPanels = [];
      this.chartPanels = [];
      this.chartPanelViews = [];
      this.dataTypeLegendItems = [];
      this.recommendedDataTypeLegendItems = [];
      this.otherDataTypeLegendItems = [];
      this.lapMarkers = [];
      this.swimLengthMarkers = [];
      this.hasSelectedSwimLengths = false;
      this.xDomain = null;
      this.zoomRange = null;
      this.zoomBarOverviewData = [];
      this.showDateOnTimeAxis = false;
      this.renderedXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType, this.selectedActivities);
      this.zoomRangeOwnerEventID = this.event?.getID?.() || null;
      this.lastPanelRebuildKey = null;
      this.lastLapMarkersKey = null;
      this.lastSwimLengthMarkersKey = null;
      this.lastPersistedCustomVisibilityKey = null;
    } finally {
      if (rebuildRequestID === this.panelBuildRequestID) {
        this.loaded();
        this.cdr.markForCheck();
      }
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
    this.sportProfile = resolveEventChartSportProfile(
      (this.selectedActivities || []).map((activity) => activity?.type),
    );
    const visibilityOwnerKey = eventID ? `${eventID}|${this.sportProfile.signature}` : null;
    const ownerChanged = this.visibilityOwnerKey !== visibilityOwnerKey;
    if (ownerChanged) {
      this.visibilityOwnerKey = visibilityOwnerKey;
      this.visibleDataTypeIDs.clear();
      this.customSelectionKeys.clear();
      this.visibilityMode = 'automatic';
      this.lastPersistedCustomVisibilityKey = null;
    }

    const recommendations = resolveEventChartRecommendations({
      profile: this.sportProfile,
      panels,
      globallyAllowedDataTypes: resolveEventChartConfiguredDataTypes(
        this.dataTypesToUse,
        this.userUnitSettings,
        (this.selectedActivities || []).map((activity) => activity?.type),
      ),
      automaticExcludedDataTypes: this.automaticExcludedDataTypes,
    });
    this.automaticDataTypeIDs = recommendations.automaticDataTypes;
    this.recommendedDataTypeOrder = recommendations.recommendedDataTypes;

    if (!ownerChanged && this.visibilityMode === 'custom') {
      this.visibleDataTypeIDs = new Set(this.resolveAvailableDataTypeIDs(
        [...this.customSelectionKeys],
        panels,
      ));
      return;
    }

    const preference = eventID
      ? this.chartSettingsLocalStorageService.getEventChartVisibilityPreference(this.event, this.sportProfile.signature)
      : {mode: 'automatic' as const, selectionKeys: []};
    const restoredDataTypeIDs = this.resolveAvailableDataTypeIDs(preference.selectionKeys, panels);
    const canRestorePreference = preference.mode === 'custom';

    if (canRestorePreference) {
      this.visibilityMode = 'custom';
      this.customSelectionKeys = new Set(
        preference.selectionKeys.map(getEventChartSelectionKey),
      );
      this.visibleDataTypeIDs = new Set(restoredDataTypeIDs);
      return;
    }

    this.visibilityMode = 'automatic';
    this.customSelectionKeys.clear();
    this.visibleDataTypeIDs = new Set(this.automaticDataTypeIDs);
  }

  private applyDataTypeVisibility(): void {
    const visibleDataTypeIDs = this.visibleDataTypeIDs;
    const panelByDataType = new Map(this.allChartPanels.map((panel) => [panel.dataType, panel]));
    this.chartPanels = this.visibilityMode === 'automatic'
      ? this.automaticDataTypeIDs
        .map((dataType) => panelByDataType.get(dataType))
        .filter((panel): panel is EventChartPanelModel => !!panel && visibleDataTypeIDs.has(panel.dataType))
      : this.allChartPanels.filter((panel) => visibleDataTypeIDs.has(panel.dataType));
    const legendItems = this.allChartPanels.map((panel) => ({
      dataType: panel.dataType,
      label: panel.displayName,
      color: visibleDataTypeIDs.has(panel.dataType)
        ? resolveEventSeriesColor(panel.colorGroupKey, 0, 1)
        : LEGEND_MUTED_DOT_COLOR,
      visible: visibleDataTypeIDs.has(panel.dataType),
    }));
    const legendItemByDataType = new Map(legendItems.map((item) => [item.dataType, item]));
    this.recommendedDataTypeLegendItems = this.sportProfile.candidateFamilies.length
      ? this.recommendedDataTypeOrder
        .map((dataType) => legendItemByDataType.get(dataType))
        .filter((item): item is EventDataTypeLegendItem => !!item)
      : [];
    const recommendedDataTypeSet = new Set(this.recommendedDataTypeLegendItems.map((item) => item.dataType));
    this.otherDataTypeLegendItems = legendItems.filter((item) => !recommendedDataTypeSet.has(item.dataType));
    this.dataTypeLegendItems = [...this.recommendedDataTypeLegendItems, ...this.otherDataTypeLegendItems];
    this.chartPanelViews = this.buildChartPanelViews();
    this.updateZoomBarOverviewData();
  }

  private buildChartPanelViews(): EventChartPanelViewModel[] {
    const panelByDataType = new Map(this.allChartPanels.map((panel) => [panel.dataType, panel]));
    const overlayMap = this.getEventChartOverlayDataTypeByPrimary();

    return this.chartPanels.map((panel) => {
      const overlayOptions = this.buildOverlayOptions(panel);
      const selectedOverlayDataType = overlayMap[panel.dataType] || null;
      const overlayPanel = selectedOverlayDataType && selectedOverlayDataType !== panel.dataType
        ? panelByDataType.get(selectedOverlayDataType) ?? null
        : null;

      return {
        panel,
        overlayPanel,
        overlayOptions,
        selectedOverlayDataType: overlayPanel ? selectedOverlayDataType : null,
      };
    });
  }

  private buildOverlayOptions(panel: EventChartPanelModel): EventChartOverlayOption[] {
    return this.allChartPanels
      .filter((candidate) => candidate.dataType !== panel.dataType)
      .map((candidate) => ({
        dataType: candidate.dataType,
        label: candidate.displayName,
        unit: candidate.unit,
        color: resolveEventSeriesColor(candidate.colorGroupKey, 0, 1),
      }));
  }

  private getEventChartOverlayDataTypeByPrimary(): Record<string, string> {
    return normalizeEventChartOverlayDataTypeByPrimary(
      this.eventChartOverlayDataTypeByPrimaryOverride
        ?? this.userSettingsQuery.chartSettings()?.eventChartOverlayDataTypeByPrimary
    );
  }

  private queueEventChartOverlayPersist(overlayMap: Record<string, string>): void {
    const requestID = ++this.eventChartOverlayPersistRequestID;
    this.eventChartOverlayPersistQueue = this.eventChartOverlayPersistQueue
      .catch(() => undefined)
      .then(() => this.userSettingsQuery.updateChartSettings({
        eventChartOverlayDataTypeByPrimary: overlayMap,
      }))
      .catch((error) => {
        this.logger.error('[EventCardChart] Failed to persist event chart overlay setting', error);
        if (
          requestID !== this.eventChartOverlayPersistRequestID
          || !areEventChartOverlayMapsEqual(this.eventChartOverlayDataTypeByPrimaryOverride, overlayMap)
        ) {
          return;
        }
        this.eventChartOverlayDataTypeByPrimaryOverride = null;
        this.applyDataTypeVisibility();
        this.cdr.markForCheck();
      });
  }

  private queueCursorBehaviourPersist(value: ChartCursorBehaviours): void {
    const requestID = ++this.cursorBehaviourPersistRequestID;
    this.cursorBehaviourConfirmedRequestID = 0;
    this.cursorBehaviourPersistQueue = this.cursorBehaviourPersistQueue
      .catch(() => undefined)
      .then(() => this.userSettingsQuery.updateChartSettings({ chartCursorBehaviour: value }))
      .then(() => {
        if (requestID !== this.cursorBehaviourPersistRequestID) {
          return;
        }

        this.cursorBehaviourConfirmedRequestID = requestID;
        if (this.userSettingsQuery.chartSettings()?.chartCursorBehaviour === this.cursorBehaviourOverride) {
          this.cursorBehaviourOverride = null;
          this.cdr.markForCheck();
        }
      })
      .catch((error) => {
        this.logger.error('[EventCardChart] Failed to persist chartCursorBehaviour setting', error);
        if (
          requestID !== this.cursorBehaviourPersistRequestID
          || this.cursorBehaviourOverride !== value
        ) {
          return;
        }

        this.cursorBehaviourConfirmedRequestID = 0;
        this.cursorBehaviourOverride = null;
        this.cdr.markForCheck();
      });
  }

  private updateZoomBarOverviewData(domain: EventChartRange | null = this.xDomain ?? this.resolveGlobalDomain(this.allChartPanels)): void {
    this.zoomBarOverviewData = buildEventZoomOverviewData(this.chartPanels, domain);
  }

  private persistCustomVisibleDataTypes(): void {
    const eventID = this.event?.getID?.();
    if (!eventID || !this.sportProfile.signature) {
      return;
    }
    const selectionKeys = [...this.customSelectionKeys]
      .sort((left, right) => left.localeCompare(right));
    const persistenceKey = `${eventID}|${this.sportProfile.signature}|${selectionKeys.join(',')}`;
    if (this.lastPersistedCustomVisibilityKey === persistenceKey) {
      return;
    }

    this.chartSettingsLocalStorageService.setEventChartCustomVisibilityPreference(
      this.event,
      this.sportProfile.signature,
      selectionKeys,
    );
    this.lastPersistedCustomVisibilityKey = persistenceKey;
  }

  private resolveAvailableDataTypeIDs(
    selectionKeys: readonly string[],
    panels: readonly EventChartPanelModel[],
  ): string[] {
    const selectedKeySet = new Set(selectionKeys.map(getEventChartSelectionKey));
    return panels
      .filter((panel) => selectedKeySet.has(getEventChartSelectionKey(panel.dataType)))
      .map((panel) => panel.dataType);
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
    const automaticExcludedDataTypesKey = [...(this.automaticExcludedDataTypes || [])]
      .sort((left, right) => left.localeCompare(right))
      .join(',');
    const unitSettingsKey = this.buildUnitSettingsKey(this.userUnitSettings);
    const intensityZoneColoringKey = this.shouldColorIntensityZoneLines() ? 'intensity-zones:1' : 'intensity-zones:0';
    const intensityZoneBoundariesKey = this.buildIntensityZoneBoundariesKey(selectedActivities);

    return [
      eventID,
      `${xAxisType}`,
      this.effectiveShowAllData ? '1' : '0',
      selectedActivityKey,
      allActivitiesKey,
      dataTypesKey,
      automaticExcludedDataTypesKey,
      unitSettingsKey,
      intensityZoneColoringKey,
      intensityZoneBoundariesKey,
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
    const unitSettingsKey = this.buildUnitSettingsKey(this.userUnitSettings);

    return [
      eventID,
      `${xAxisType}`,
      selectedActivityKey,
      allActivitiesKey,
      lapTypesKey,
      unitSettingsKey,
    ].join('|');
  }

  private buildSwimLengthMarkersRebuildKey(
    selectedActivities: ActivityInterface[],
    allActivities: ActivityInterface[],
    xAxisType: XAxisTypes,
    hasSelectedSwimLengths: boolean
  ): string {
    const eventID = this.event?.getID?.() || '';
    if (!this.showSwimLengths || !hasSelectedSwimLengths) {
      return `${eventID}|hidden`;
    }

    const selectedActivityKey = this.buildActivitiesKey(selectedActivities);
    const allActivitiesKey = this.buildActivitiesKey(allActivities);
    const unitSettingsKey = this.buildUnitSettingsKey(this.userUnitSettings);

    return [
      eventID,
      `${xAxisType}`,
      selectedActivityKey,
      allActivitiesKey,
      unitSettingsKey,
    ].join('|');
  }

  private buildActivitiesKey(activities: ActivityInterface[]): string {
    return (activities || [])
      .map((activity) => `${activity?.getID?.() || ''}:${activity?.type || ''}`)
      .join(',');
  }

  private shouldColorIntensityZoneLines(): boolean {
    return this.event?.isMerge !== true;
  }

  private buildIntensityZoneBoundariesKey(activities: ActivityInterface[]): string {
    return (activities || [])
      .map((activity) => {
        const activityID = activity?.getID?.() || '';
        const zoneBoundaries = EVENT_CHART_INTENSITY_ZONE_LINE_DATA_TYPES.map((dataType) => {
          const intensityZones = activity.intensityZones
            ?.find((zone) => zone?.type === dataType);
          if (!intensityZones) {
            return `${dataType}:`;
          }

          return [
            dataType,
            ...EVENT_CHART_INTENSITY_ZONE_LOWER_LIMIT_KEYS.map((key) => intensityZones[key] ?? ''),
          ].join(':');
        });

        return [activityID, ...zoneBoundaries].join(':');
      })
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

    const effectiveXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType, this.selectedActivities);

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
    const distanceStream = this.getActivityStream(activity, DataDistance.type)
      || this.getActivityStream(activity, DataStrydDistance.type);
    const timeStream = this.getActivityStream(activity, XAxisTypes.Time);
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

  private getActivityStream(activity: ActivityInterface, streamType: string): StreamInterface | null {
    if (!activity || !streamType) {
      return null;
    }

    if (typeof activity.getStream === 'function') {
      try {
        const stream = activity.getStream(streamType);
        if (stream) {
          return stream;
        }
      } catch {
        // Some providers throw when optional streams are unavailable.
      }
    }

    const streams = activity.getAllStreams?.() || [];
    return streams.find((stream) => stream?.type === streamType) || null;
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
