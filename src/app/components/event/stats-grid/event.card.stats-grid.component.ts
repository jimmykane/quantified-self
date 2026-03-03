import {
  AfterViewInit,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataInterface } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { buildDiffMapForStats } from '../../../helpers/stats-diff.helper';
import { getDefaultSummaryStatTypes } from '../../../helpers/summary-stats.helper';
import { LoggerService } from '../../../services/logger.service';
import { AppBreakpoints } from '../../../constants/breakpoints';
import {
  EVENT_SUMMARY_DEFAULT_GROUP_ID,
  EventSummaryMetricGroupId,
} from '../../../constants/event-summary-metric-groups';
import { buildSummaryMetricTabs, SummaryMetricTab } from '../../../helpers/summary-metric-tabs.helper';
import { expandStatsTypesForCompositeDiff } from '../../../helpers/header-stats-composite.helper';
import { AppEventSummaryTabsLocalStorageService } from '../../../services/storage/app.event-summary-tabs.local.storage.service';

const SUMMARY_TAB_ICONS: Record<EventSummaryMetricGroupId, string> = {
  overall: 'leaderboard',
  performance: 'monitoring',
  altitude: 'terrain',
  environment: 'landscape_2',
  device: 'devices',
  physiological: 'demography',
  other: 'category',
};
const SUMMARY_TAB_HEIGHT_WOBBLE_TOLERANCE_PX = 2;
const STATS_GRID_PERF_LOGS_ENABLED = false;
const SUMMARY_TAB_SWITCH_ANIMATION_DURATION_MS = 300;
type TabBodyHeightSyncMode = 'allow_shrink' | 'only_grow';

@Component({
  selector: 'app-event-card-stats-grid',
  templateUrl: './event.card.stats-grid.component.html',
  styleUrls: ['./event.card.stats-grid.component.scss'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardStatsGridComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('summaryTabGroup', { read: ElementRef }) summaryTabGroupRef?: ElementRef<HTMLElement>;
  @Input() event!: EventInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  // @Input() unitSettings = AppUserService.getDefaultUserUnitSettings(); // Removed, using service signal
  @Input() statsToShow?: string[]; // Optional override
  @Input() layout: 'grid' | 'condensed' = 'grid';

  public displayedStatsToShow: string[] = [];
  public stats: DataInterface[] = [];
  public metricTabs: SummaryMetricTab[] = [];
  public selectedTabIndex = 0;
  public tabAnimationDuration = `${SUMMARY_TAB_SWITCH_ANIMATION_DURATION_MS}ms`;
  public showDiff = false;
  public diffByType = new Map<string, { display: string; percent: number; color: string }>();
  private resizeObserver: ResizeObserver | null = null;
  private measureRafId: number | null = null;
  private tabSwitchMeasureRafId: number | null = null;
  private initialSettleTimeoutId: number | null = null;
  private lastAppliedMinHeightPx = 0;
  private lastMeasuredTabBodyLayoutSignature: string | null = null;
  private lastAllowShrinkSyncAtMs = 0;
  private pendingTabBodyHeightSyncMode: TabBodyHeightSyncMode = 'allow_shrink';
  private didPrewarmTabs = false;
  private isPrewarmingTabs = false;
  private isDestroyed = false;
  private mobileViewportMediaQueryList: MediaQueryList | null = this.getMobileMediaQueryList();
  private readonly mobileViewportListener = () => this.onMobileViewportChange();
  private readonly windowResizeListener = () => this.scheduleTabBodyHeightSync('allow_shrink');
  private readonly windowLoadListener = () => this.scheduleTabBodyHeightSync('allow_shrink', true);
  private cdr = inject(ChangeDetectorRef);

  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private eventColorService = inject(AppEventColorService);
  private logger = inject(LoggerService);
  private eventSummaryTabsLocalStorageService = inject(AppEventSummaryTabsLocalStorageService);

  public get unitSettings() {
    return this.userSettingsQuery.unitSettings();
  }

  public get summariesSettings() {
    return this.userSettingsQuery.summariesSettings();
  }

  ngAfterViewInit() {
    this.isDestroyed = false;
    this.mobileViewportMediaQueryList?.addEventListener('change', this.mobileViewportListener);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.windowResizeListener);
      if (document.readyState !== 'complete') {
        window.addEventListener('load', this.windowLoadListener, { once: true });
      }
    }
    this.setupTabBodyResizeObserver();
    this.scheduleInitialTabBodyHeightStabilization();
    this.scheduleInitialTabsPrewarm();
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    this.mobileViewportMediaQueryList?.removeEventListener('change', this.mobileViewportListener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.windowResizeListener);
      window.removeEventListener('load', this.windowLoadListener);
    }
    this.cancelScheduledTabBodyHeightSync();
    this.teardownTabBodyResizeObserver();
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    const ngChangesStart = this.getPerfStart();
    if (!this.selectedActivities.length) {
      this.displayedStatsToShow = [];
      this.stats = [];
      this.metricTabs = [];
      this.selectedTabIndex = 0;
      this.showDiff = false;
      this.diffByType = new Map();
      this.lastAppliedMinHeightPx = 0;
      this.clearTabBodyMinHeight();
      this.invalidateTabBodyLayoutSignature();
      this.cancelScheduledTabBodyHeightSync();
      this.teardownTabBodyResizeObserver();
      if (STATS_GRID_PERF_LOGS_ENABLED) {
        this.logPerf('empty_selection', ngChangesStart);
      }
      return;
    }

    const statsBuildStart = this.getPerfStart();
    if (this.selectedActivities.length === 1) {
      this.stats = this.getStatsForActivity(this.selectedActivities[0]);
    } else if (this.selectedActivities.length === this.event.getActivities().length) {
      this.stats = [...this.event.getStats().values()];
    } else {
      this.stats = ActivityUtilities.getSummaryStatsForActivities(this.selectedActivities);
    }
    if (STATS_GRID_PERF_LOGS_ENABLED) {
      this.logPerf('build_stats', statsBuildStart, {
        selectedActivities: this.selectedActivities.length,
        statsCount: this.stats.length,
        eventId: this.event?.getID?.(),
      });
    }

    const activityTypes = (this.selectedActivities || []).map((activity: ActivityInterface) => activity.type).filter(type => !!type) as ActivityTypes[];

    if (this.statsToShow) {
      this.displayedStatsToShow = this.statsToShow;
      this.updateTabs();
      this.updateDiffMap();
      if (STATS_GRID_PERF_LOGS_ENABLED) {
        this.logPerf('ng_on_changes_total', ngChangesStart, { usedStatsOverride: true });
      }
      return;
    }

    // the order here is important
    const summaryTypesStart = this.getPerfStart();
    this.displayedStatsToShow = getDefaultSummaryStatTypes(activityTypes, this.summariesSettings);
    if (STATS_GRID_PERF_LOGS_ENABLED) {
      this.logPerf('build_default_summary_stat_types', summaryTypesStart, {
        activityTypes: activityTypes.length,
        displayedStats: this.displayedStatsToShow.length,
        eventId: this.event?.getID?.(),
      });
    }

    this.updateTabs();
    this.updateDiffMap();
    if (STATS_GRID_PERF_LOGS_ENABLED) {
      this.logPerf('ng_on_changes_total', ngChangesStart, { usedStatsOverride: false });
    }
  }

  public onSelectedTabIndexChange(index: number) {
    this.selectedTabIndex = index;
    if (this.isPrewarmingTabs) {
      return;
    }
    const selectedTabId = this.metricTabs[index]?.id;
    if (selectedTabId) {
      this.eventSummaryTabsLocalStorageService.setLastSelectedStatsTabId(selectedTabId);
    }
    this.setupTabBodyResizeObserver();
    this.applyGrowOnlyHeightFromSelectedTab(index);
    this.scheduleTabBodyHeightSyncAfterTabSwitch();
  }

  public getSingleValueTypesForTab(tab: SummaryMetricTab): string[] {
    if (!tab) {
      return [];
    }

    if (tab.id === EVENT_SUMMARY_DEFAULT_GROUP_ID) {
      return [...new Set(tab.metricTypes || []).values()];
    }

    if (!tab.singleValueTypes?.length) {
      return [];
    }

    return tab.singleValueTypes;
  }

  public getTabIcon(tabId: EventSummaryMetricGroupId): string {
    return SUMMARY_TAB_ICONS[tabId] || SUMMARY_TAB_ICONS.other;
  }

  private updateDiffMap() {
    const diffStart = this.getPerfStart();
    this.showDiff = !!this.event?.isMerge && this.selectedActivities.length === 2;
    if (!this.showDiff || !this.unitSettings) {
      this.diffByType = new Map();
      if (STATS_GRID_PERF_LOGS_ENABLED) {
        this.logPerf('update_diff_map', diffStart, { showDiff: false });
      }
      return;
    }
    this.diffByType = this.buildDiffMap();
    if (STATS_GRID_PERF_LOGS_ENABLED) {
      this.logPerf('update_diff_map', diffStart, { showDiff: true, diffCount: this.diffByType.size });
    }
  }

  private buildDiffMap(): Map<string, { display: string; percent: number; color: string }> {
    const compositeAwareTypes = expandStatsTypesForCompositeDiff(this.displayedStatsToShow);
    const diffMap = buildDiffMapForStats(this.stats, compositeAwareTypes, this.selectedActivities, this.unitSettings);
    const coloredMap = new Map<string, { display: string; percent: number; color: string }>();
    diffMap.forEach((diff, type) => {
      coloredMap.set(type, {
        display: diff.display,
        percent: diff.percent,
        color: this.eventColorService.getDifferenceColor(diff.percent)
      });
    });
    return coloredMap;
  }

  private updateTabs() {
    const availableStatTypes = new Set(this.stats.map((stat) => stat.getType()));
    this.metricTabs = buildSummaryMetricTabs(this.displayedStatsToShow)
      .map((tab) => ({
        ...tab,
        metricTypes: tab.metricTypes.filter((metricType) => availableStatTypes.has(metricType)),
      }))
      .filter((tab) => tab.metricTypes.length > 0);
    this.resetSelectedTab();
    this.invalidateTabBodyLayoutSignature();
    this.setupTabBodyResizeObserver();
    this.scheduleTabBodyHeightSync();
    this.scheduleInitialTabsPrewarm();
  }

  private scheduleTabBodyHeightSync(mode: TabBodyHeightSyncMode = 'allow_shrink', force = false) {
    if (this.isDestroyed) {
      return;
    }

    if (this.isMobileViewport()) {
      this.clearTabBodyMinHeight();
      this.lastAppliedMinHeightPx = 0;
      this.lastMeasuredTabBodyLayoutSignature = null;
      this.pendingTabBodyHeightSyncMode = 'allow_shrink';
      return;
    }

    if (
      !force
      && mode === 'allow_shrink'
      && this.measureRafId === null
      && this.shouldSkipRedundantAllowShrinkSync()
    ) {
      return;
    }

    if (mode === 'allow_shrink') {
      this.pendingTabBodyHeightSyncMode = 'allow_shrink';
    } else if (this.measureRafId === null) {
      this.pendingTabBodyHeightSyncMode = 'only_grow';
    }

    if (this.measureRafId !== null) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.syncTabBodyHeight(this.pendingTabBodyHeightSyncMode);
      return;
    }

    this.measureRafId = requestAnimationFrame(() => {
      this.measureRafId = null;
      const syncMode = this.pendingTabBodyHeightSyncMode;
      this.pendingTabBodyHeightSyncMode = 'allow_shrink';
      this.syncTabBodyHeight(syncMode);
    });
  }

  private scheduleTabBodyHeightSyncAfterTabSwitch() {
    if (this.isDestroyed) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.scheduleTabBodyHeightSync('only_grow');
      return;
    }

    if (this.tabSwitchMeasureRafId !== null) {
      return;
    }

    this.tabSwitchMeasureRafId = requestAnimationFrame(() => {
      this.tabSwitchMeasureRafId = null;
      if (this.isDestroyed) {
        return;
      }
      if (typeof requestAnimationFrame === 'undefined') {
        this.scheduleTabBodyHeightSync('only_grow');
        return;
      }
      this.tabSwitchMeasureRafId = requestAnimationFrame(() => {
        this.tabSwitchMeasureRafId = null;
        if (this.isDestroyed) {
          return;
        }
        this.scheduleTabBodyHeightSync('only_grow');
      });
    });
  }

  private scheduleInitialTabBodyHeightStabilization() {
    this.scheduleTabBodyHeightSync('allow_shrink');

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.scheduleTabBodyHeightSync('allow_shrink');
        });
      });
    }

    this.scheduleDelayedInitialHeightSync(220);
    this.scheduleHeightSyncWhenFontsAreReady();
  }

  private scheduleInitialTabsPrewarm() {
    if (
      this.isDestroyed
      || this.didPrewarmTabs
      || this.isPrewarmingTabs
      || this.isMobileViewport()
      || this.metricTabs.length < 2
      || this.selectedTabIndex !== 0
      || !this.summaryTabGroupRef?.nativeElement
      || typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }

    this.setTabAnimationEnabled(false);
    this.didPrewarmTabs = true;
    this.isPrewarmingTabs = true;
    this.prewarmAllTabsSynchronously();
    this.finishTabsPrewarm();
  }

  private finishTabsPrewarm() {
    this.selectedTabIndex = 0;
    this.cdr.detectChanges();
    this.isPrewarmingTabs = false;
    this.setTabAnimationEnabled(true);
    this.scheduleTabBodyHeightSync('allow_shrink', true);
  }

  private setTabAnimationEnabled(enabled: boolean) {
    const nextDuration = enabled ? `${SUMMARY_TAB_SWITCH_ANIMATION_DURATION_MS}ms` : '0ms';
    if (this.tabAnimationDuration === nextDuration) {
      return;
    }
    this.tabAnimationDuration = nextDuration;
    this.cdr.markForCheck();
  }

  private prewarmAllTabsSynchronously() {
    if (this.isDestroyed || !this.metricTabs.length) {
      return;
    }

    const initialTabIndex = this.selectedTabIndex;
    for (let tabIndex = 0; tabIndex < this.metricTabs.length; tabIndex += 1) {
      if (tabIndex === initialTabIndex) {
        continue;
      }
      this.selectedTabIndex = tabIndex;
      // Force tab body instantiation without waiting for animation frames.
      this.cdr.detectChanges();
    }
    this.selectedTabIndex = initialTabIndex;
  }

  private scheduleDelayedInitialHeightSync(delayMs: number) {
    if (this.isDestroyed || typeof window === 'undefined') {
      return;
    }

    if (this.initialSettleTimeoutId !== null) {
      window.clearTimeout(this.initialSettleTimeoutId);
    }

    this.initialSettleTimeoutId = window.setTimeout(() => {
      this.initialSettleTimeoutId = null;
      this.scheduleTabBodyHeightSync('allow_shrink', true);
    }, delayMs);
  }

  private scheduleHeightSyncWhenFontsAreReady() {
    if (this.isDestroyed || typeof document === 'undefined') {
      return;
    }

    const fontsApi = (document as any).fonts;
    if (!fontsApi?.ready || typeof fontsApi.ready.then !== 'function') {
      return;
    }

    void fontsApi.ready
      .then(() => {
        this.scheduleTabBodyHeightSync('allow_shrink', true);
      })
      .catch(() => {
        this.scheduleTabBodyHeightSync('allow_shrink', true);
      });
  }

  private syncTabBodyHeight(mode: TabBodyHeightSyncMode = 'allow_shrink') {
    if (this.isMobileViewport()) {
      this.clearTabBodyMinHeight();
      this.lastAppliedMinHeightPx = 0;
      this.lastMeasuredTabBodyLayoutSignature = null;
      return;
    }

    const tabGroupElement = this.summaryTabGroupRef?.nativeElement;
    if (!tabGroupElement) {
      return;
    }

    const tabBodyWrapper = tabGroupElement.querySelector<HTMLElement>('.mat-mdc-tab-body-wrapper');
    if (!tabBodyWrapper) {
      return;
    }

    const tabBodyContents = tabGroupElement.querySelectorAll<HTMLElement>('.mat-mdc-tab-body-content');
    if (!tabBodyContents.length) {
      return;
    }

    const layoutSignature = this.buildTabBodyLayoutSignature(tabGroupElement, tabBodyContents.length);
    this.lastMeasuredTabBodyLayoutSignature = layoutSignature;

    const maxHeight = Array.from(tabBodyContents).reduce((currentMax, tabBodyContent) => {
      return Math.max(currentMax, this.getIntrinsicTabBodyContentHeight(tabBodyContent));
    }, 0);

    const heightDelta = Math.abs(maxHeight - this.lastAppliedMinHeightPx);
    if (heightDelta === 0) {
      return;
    }

    if (this.lastAppliedMinHeightPx > 0 && heightDelta <= SUMMARY_TAB_HEIGHT_WOBBLE_TOLERANCE_PX) {
      return;
    }

    if (mode === 'only_grow' && maxHeight < this.lastAppliedMinHeightPx) {
      return;
    }

    if (mode === 'allow_shrink') {
      this.lastAllowShrinkSyncAtMs = performance.now();
    }

    this.lastAppliedMinHeightPx = maxHeight;
    tabGroupElement.style.setProperty('--summary-tabs-body-min-height', `${maxHeight}px`);
  }

  private getIntrinsicTabBodyContentHeight(tabBodyContent: HTMLElement): number {
    const previousInlineHeight = tabBodyContent.style.height;
    tabBodyContent.style.height = 'auto';
    const intrinsicHeight = Math.ceil(tabBodyContent.scrollHeight);
    tabBodyContent.style.height = previousInlineHeight;
    return intrinsicHeight;
  }

  private getTabIntrinsicHeightByIndex(tabIndex: number): number {
    const tabGroupElement = this.summaryTabGroupRef?.nativeElement;
    if (!tabGroupElement || tabIndex < 0) {
      return 0;
    }

    const tabBodyContents = tabGroupElement.querySelectorAll<HTMLElement>('.mat-mdc-tab-body-content');
    const tabBody = tabBodyContents[tabIndex];
    if (!tabBody) {
      return 0;
    }

    return this.getIntrinsicTabBodyContentHeight(tabBody);
  }

  private applyGrowOnlyHeightFromSelectedTab(selectedIndex: number) {
    const tabGroupElement = this.summaryTabGroupRef?.nativeElement;
    if (!tabGroupElement || selectedIndex < 0) {
      return;
    }

    const tabBodyContents = tabGroupElement.querySelectorAll<HTMLElement>('.mat-mdc-tab-body-content');
    const selectedTabBody = tabBodyContents[selectedIndex];
    if (!selectedTabBody) {
      return;
    }

    const selectedTabHeight = Math.max(
      this.getIntrinsicTabBodyContentHeight(selectedTabBody),
      Math.ceil(selectedTabBody.scrollHeight || 0),
      Math.ceil(selectedTabBody.offsetHeight || 0),
      Math.ceil(selectedTabBody.clientHeight || 0),
    );

    if (selectedTabHeight <= this.lastAppliedMinHeightPx) {
      return;
    }

    const heightDelta = Math.abs(selectedTabHeight - this.lastAppliedMinHeightPx);
    if (this.lastAppliedMinHeightPx > 0 && heightDelta <= SUMMARY_TAB_HEIGHT_WOBBLE_TOLERANCE_PX) {
      return;
    }

    this.lastAppliedMinHeightPx = selectedTabHeight;
    tabGroupElement.style.setProperty('--summary-tabs-body-min-height', `${selectedTabHeight}px`);
  }

  private setupTabBodyResizeObserver() {
    this.teardownTabBodyResizeObserver();

    if (this.isMobileViewport()) {
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const tabGroupElement = this.summaryTabGroupRef?.nativeElement;
    if (!tabGroupElement) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleTabBodyHeightSync('allow_shrink', true);
    });
    this.resizeObserver.observe(tabGroupElement);
    const activeTabBodyContent = tabGroupElement.querySelector<HTMLElement>('.mat-mdc-tab-body-active .mat-mdc-tab-body-content');
    if (activeTabBodyContent) {
      this.resizeObserver.observe(activeTabBodyContent);
    }
  }

  private teardownTabBodyResizeObserver() {
    if (!this.resizeObserver) {
      return;
    }

    this.resizeObserver.disconnect();
    this.resizeObserver = null;
  }

  private cancelScheduledTabBodyHeightSync() {
    if (this.measureRafId === null || typeof cancelAnimationFrame === 'undefined') {
      this.measureRafId = null;
    } else {
      cancelAnimationFrame(this.measureRafId);
      this.measureRafId = null;
    }

    if (this.tabSwitchMeasureRafId === null || typeof cancelAnimationFrame === 'undefined') {
      this.tabSwitchMeasureRafId = null;
    } else {
      cancelAnimationFrame(this.tabSwitchMeasureRafId);
      this.tabSwitchMeasureRafId = null;
    }

    this.isPrewarmingTabs = false;

    if (this.initialSettleTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.initialSettleTimeoutId);
      this.initialSettleTimeoutId = null;
    }
  }

  private clearTabBodyMinHeight() {
    const tabGroupElement = this.summaryTabGroupRef?.nativeElement;
    tabGroupElement?.style.removeProperty('--summary-tabs-body-min-height');
  }

  private onMobileViewportChange() {
    this.cancelScheduledTabBodyHeightSync();
    this.lastAppliedMinHeightPx = 0;
    this.invalidateTabBodyLayoutSignature();
    this.pendingTabBodyHeightSyncMode = 'allow_shrink';

    if (this.isMobileViewport()) {
      this.teardownTabBodyResizeObserver();
      this.clearTabBodyMinHeight();
      return;
    }

    this.setupTabBodyResizeObserver();
    this.scheduleTabBodyHeightSync();
  }

  private getMobileMediaQueryList(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return null;
    }

    return window.matchMedia(AppBreakpoints.XSmall);
  }

  private isMobileViewport(): boolean {
    return this.mobileViewportMediaQueryList?.matches ?? false;
  }

  private resetSelectedTab() {
    if (!this.metricTabs.length) {
      this.selectedTabIndex = 0;
      return;
    }

    const storedTabId = this.eventSummaryTabsLocalStorageService.getLastSelectedStatsTabId() as EventSummaryMetricGroupId;
    const storedTabIndex = this.metricTabs.findIndex((tab) => tab.id === storedTabId);

    if (storedTabIndex >= 0) {
      this.selectedTabIndex = storedTabIndex;
      return;
    }

    const defaultTabIndex = this.metricTabs.findIndex((tab) => tab.id === EVENT_SUMMARY_DEFAULT_GROUP_ID);
    this.selectedTabIndex = defaultTabIndex >= 0 ? defaultTabIndex : 0;

    const fallbackTabId = this.metricTabs[this.selectedTabIndex]?.id;
    if (fallbackTabId && fallbackTabId !== storedTabId) {
      this.eventSummaryTabsLocalStorageService.setLastSelectedStatsTabId(fallbackTabId);
    }
  }

  private getStatsForActivity(activity: ActivityInterface): DataInterface[] {
    const statsMap = (activity as any)?.getStats?.();
    if (statsMap?.values) {
      return [...statsMap.values()];
    }

    const statsArray = (activity as any)?.getStatsAsArray?.();
    return Array.isArray(statsArray) ? statsArray : [];
  }

  private logPerf(step: string, start: number, meta?: Record<string, unknown>) {
    if (!STATS_GRID_PERF_LOGS_ENABLED) {
      return;
    }
    this.logger.info(`[perf] event_card_stats_grid_${step}`, {
      durationMs: Number((performance.now() - start).toFixed(2)),
      ...(meta || {}),
    });
  }

  private getPerfStart(): number {
    return STATS_GRID_PERF_LOGS_ENABLED ? performance.now() : 0;
  }

  private invalidateTabBodyLayoutSignature() {
    this.lastMeasuredTabBodyLayoutSignature = null;
  }

  private buildTabBodyLayoutSignature(tabGroupElement: HTMLElement, tabCount: number): string {
    return `${tabGroupElement.clientWidth}|${tabCount}|${this.selectedTabIndex}`;
  }

  private shouldSkipRedundantAllowShrinkSync(): boolean {
    const tabGroupElement = this.summaryTabGroupRef?.nativeElement;
    if (!tabGroupElement) {
      return false;
    }

    const tabCount = tabGroupElement.querySelectorAll('.mat-mdc-tab-body-content').length;
    if (!tabCount) {
      return false;
    }

    const nextSignature = this.buildTabBodyLayoutSignature(tabGroupElement, tabCount);
    if (this.lastMeasuredTabBodyLayoutSignature !== nextSignature) {
      return false;
    }

    return performance.now() - this.lastAllowShrinkSyncAtMs < 80;
  }

  private getStatsSourceLabel(eventActivitiesCount: number): 'single_activity' | 'event_stats' | 'selected_activities_summary' {
    if (this.selectedActivities.length === 1) {
      return 'single_activity';
    }
    if (this.selectedActivities.length === eventActivitiesCount) {
      return 'event_stats';
    }
    return 'selected_activities_summary';
  }

  private getEventStats(): DataInterface[] {
    const eventStats = (this.event as any)?.getStats?.();
    if (!eventStats) {
      return [];
    }
    if (Array.isArray(eventStats)) {
      return eventStats as DataInterface[];
    }
    if (typeof eventStats.values === 'function') {
      return [...eventStats.values()] as DataInterface[];
    }
    return [];
  }

  private getStatType(stat: DataInterface): string {
    try {
      return stat?.getType?.() || '';
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
      return String(stat?.getDisplayValue?.() || '');
    } catch {
      return '';
    }
  }

  private getSafeDisplayUnit(stat: DataInterface): string {
    try {
      return String(stat?.getDisplayUnit?.() || '');
    } catch {
      return '';
    }
  }
}
