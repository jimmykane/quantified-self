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
import { throttleTime } from 'rxjs/operators';
import { Subject, Subscription, asyncScheduler } from 'rxjs';
import {
  ActivityInterface,
  ChartCursorBehaviours,
  ChartThemes,
  DataDistance,
  DataStrydDistance,
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
import {
  buildEventChartPanels,
  buildEventLapMarkers,
  EventChartLapMarker,
  EventChartPanelModel,
} from '../../../helpers/event-echarts-data.helper';
import { resolveEventSeriesColor } from '../../../helpers/event-echarts-style.helper';
import {
  clampEventRange,
  EventChartRange,
  resolveEventChartXAxisType,
} from '../../../helpers/event-echarts-xaxis.helper';

interface EventDataTypeLegendItem {
  dataType: string;
  label: string;
  color: string;
  visible: boolean;
}

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
  public zoomResetVersion = 0;
  public selectionRange: EventChartRange | null = null;
  public interactionMode: 'zoom' | 'select' = 'zoom';
  public renderedXAxisType: XAxisTypes = XAxisTypes.Duration;
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

  public get chartCursorBehaviour() {
    return this.userSettingsQuery.chartSettings()?.chartCursorBehaviour ?? AppUserUtilities.getDefaultChartCursorBehaviour();
  }
  public set chartCursorBehaviour(value: ChartCursorBehaviours) {
    if (value !== this.chartCursorBehaviour) {
      void this.userSettingsQuery.updateChartSettings({ chartCursorBehaviour: value })
        .catch((error) => this.logger.error('[EventCardChart] Failed to persist chartCursorBehaviour', error));
    }
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

  public get gainAndLossThreshold() {
    return this.userSettingsQuery.chartSettings()?.gainAndLossThreshold ?? AppUserUtilities.getDefaultGainAndLossThreshold();
  }

  public get extraMaxForPower() {
    return this.userSettingsQuery.chartSettings()?.extraMaxForPower ?? AppUserUtilities.getDefaultExtraMaxForPower();
  }

  public get extraMaxForPace() {
    return this.userSettingsQuery.chartSettings()?.extraMaxForPace ?? AppUserUtilities.getDefaultExtraMaxForPace();
  }

  public get useAnimations() {
    return this.userSettingsQuery.chartSettings()?.useAnimations === true;
  }

  public get userUnitSettings() {
    return this.userSettingsQuery.unitSettings();
  }

  public get dataTypesToUse(): string[] {
    return this.user ? this.userService.getUserChartDataTypesToUse(this.user) : [];
  }

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
  private cursorPositionSubject = new Subject<number>();
  private cursorPositionSubscription?: Subscription;
  private xAxisTypeOverride: XAxisTypes | null = null;
  private pendingRebuild = false;
  private visibleDataTypeIDs = new Set<string>();
  private visibilityEventID: string | null = null;

  constructor() {
    runInInjectionContext(this.injector, () => {
      effect(() => {
        const theme = this.themeSignal();
        this.userSettingsQuery.chartSettings();
        this.userSettingsQuery.unitSettings();

        this.chartTheme = theme ?? ChartThemes.Material;
        this.interactionMode = this.chartCursorBehaviour === ChartCursorBehaviours.SelectX ? 'select' : 'zoom';
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

  public onInteractionModeChange(mode: 'zoom' | 'select'): void {
    if (mode === this.interactionMode) {
      return;
    }

    this.interactionMode = mode;
    this.chartCursorBehaviour = mode === 'select' ? ChartCursorBehaviours.SelectX : ChartCursorBehaviours.ZoomX;

    if (mode === 'zoom') {
      this.selectionRange = null;
    }
  }

  public onResetZoom(): void {
    this.zoomResetVersion += 1;
  }

  public onClearSelection(): void {
    this.selectionRange = null;
  }

  public onPanelSelectionRangeChange(range: EventChartRange | null): void {
    if (this.interactionMode !== 'select') {
      return;
    }
    if (!range) {
      this.selectionRange = null;
      return;
    }

    const clampedRange = this.xDomain
      ? clampEventRange(range, this.xDomain.start, this.xDomain.end)
      : range;
    if (!clampedRange || this.areRangesEqual(this.selectionRange, clampedRange)) {
      return;
    }
    this.selectionRange = clampedRange;
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
    this.loading();

    try {
      const allActivities = this.event?.getActivities?.() || this.selectedActivities || [];
      const selectedActivities = this.selectedActivities || [];
      const effectiveXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType);
      this.renderedXAxisType = effectiveXAxisType;
      this.zoomSyncGroupId = this.resolveZoomSyncGroupID(this.event);

      this.allChartPanels = buildEventChartPanels({
        selectedActivities,
        allActivities,
        xAxisType: effectiveXAxisType,
        showAllData: this.showAllData,
        dataTypesToUse: this.dataTypesToUse,
        userUnitSettings: this.userUnitSettings,
        eventColorService: this.eventColorService,
      });

      this.syncVisibleDataTypes(this.allChartPanels);
      this.applyDataTypeVisibility();
      this.persistVisibleDataTypes();
      this.lapMarkers = this.showLaps
        ? buildEventLapMarkers({
          selectedActivities,
          allActivities,
          xAxisType: effectiveXAxisType,
          lapTypes: this.lapTypes,
          eventColorService: this.eventColorService,
        })
        : [];

      const globalDomain = this.resolveGlobalDomain(this.allChartPanels);
      this.xDomain = globalDomain;
      if (!globalDomain) {
        this.selectionRange = null;
      } else {
        this.selectionRange = this.selectionRange
          ? clampEventRange(this.selectionRange, globalDomain.start, globalDomain.end)
          : null;
      }

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
      this.selectionRange = null;
      this.renderedXAxisType = resolveEventChartXAxisType(this.event, this.xAxisType);
      this.zoomSyncGroupId = this.resolveZoomSyncGroupID(this.event);
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

  private syncVisibleDataTypes(panels: EventChartPanelModel[]): void {
    const eventID = this.event?.getID?.() || null;
    if (this.visibilityEventID !== eventID) {
      this.visibilityEventID = eventID;
      this.visibleDataTypeIDs.clear();
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
      color: resolveEventSeriesColor(panel.colorGroupKey, 0, 1),
      visible: visibleDataTypeIDs.has(panel.dataType),
    }));
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
    if (!this.event?.getID?.()) {
      return;
    }
    this.chartSettingsLocalStorageService.setDataTypeIDsToShow(
      this.event,
      [...this.visibleDataTypeIDs],
    );
  }

  private resolveZoomSyncGroupID(event: EventInterface | null | undefined): string | null {
    const eventID = event?.getID?.();
    if (!eventID) {
      return null;
    }
    return `event-chart-zoom-${eventID}`;
  }

  private areRangesEqual(left: EventChartRange | null, right: EventChartRange | null): boolean {
    if (!left || !right) {
      return false;
    }
    return Math.abs(left.start - right.start) < 0.0001 && Math.abs(left.end - right.end) < 0.0001;
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
