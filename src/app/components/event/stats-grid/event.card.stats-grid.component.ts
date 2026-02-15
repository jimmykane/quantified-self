import {
  AfterViewInit,
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

@Component({
  selector: 'app-event-card-stats-grid',
  templateUrl: './event.card.stats-grid.component.html',
  styleUrls: ['./event.card.stats-grid.component.css'],
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
  public showDiff = false;
  public diffByType = new Map<string, { display: string; percent: number; color: string }>();
  private resizeObserver: ResizeObserver | null = null;
  private measureRafId: number | null = null;
  private lastAppliedMinHeightPx = 0;
  private mobileViewportMediaQueryList: MediaQueryList | null = this.getMobileMediaQueryList();
  private readonly mobileViewportListener = () => this.onMobileViewportChange();

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
    this.mobileViewportMediaQueryList?.addEventListener('change', this.mobileViewportListener);
    this.setupTabBodyResizeObserver();
    this.scheduleTabBodyHeightSync();
  }

  ngOnDestroy() {
    this.mobileViewportMediaQueryList?.removeEventListener('change', this.mobileViewportListener);
    this.cancelScheduledTabBodyHeightSync();
    this.teardownTabBodyResizeObserver();
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    const ngChangesStart = performance.now();
    if (!this.selectedActivities.length) {
      this.displayedStatsToShow = [];
      this.stats = [];
      this.metricTabs = [];
      this.selectedTabIndex = 0;
      this.showDiff = false;
      this.diffByType = new Map();
      this.lastAppliedMinHeightPx = 0;
      this.clearTabBodyMinHeight();
      this.cancelScheduledTabBodyHeightSync();
      this.teardownTabBodyResizeObserver();
      this.logPerf('empty_selection', ngChangesStart);
      return;
    }

    const statsBuildStart = performance.now();
    if (this.selectedActivities.length === 1) {
      this.stats = this.getStatsForActivity(this.selectedActivities[0]);
    } else if (this.selectedActivities.length === this.event.getActivities().length) {
      this.stats = [...this.event.getStats().values()];
    } else {
      this.stats = ActivityUtilities.getSummaryStatsForActivities(this.selectedActivities);
    }
    this.logPerf('build_stats', statsBuildStart, {
      selectedActivities: this.selectedActivities.length,
      statsCount: this.stats.length,
      eventId: this.event?.getID?.(),
    });

    const activityTypes = (this.selectedActivities || []).map((activity: ActivityInterface) => activity.type).filter(type => !!type) as ActivityTypes[];

    if (this.statsToShow) {
      this.displayedStatsToShow = this.statsToShow;
      this.updateTabs();
      this.updateDiffMap();
      this.logPerf('ng_on_changes_total', ngChangesStart, { usedStatsOverride: true });
      return;
    }

    // the order here is important
    const summaryTypesStart = performance.now();
    this.displayedStatsToShow = getDefaultSummaryStatTypes(activityTypes, this.summariesSettings);
    this.logPerf('build_default_summary_stat_types', summaryTypesStart, {
      activityTypes: activityTypes.length,
      displayedStats: this.displayedStatsToShow.length,
      eventId: this.event?.getID?.(),
    });

    this.updateTabs();
    this.updateDiffMap();
    this.logPerf('ng_on_changes_total', ngChangesStart, { usedStatsOverride: false });
  }

  public onSelectedTabIndexChange(index: number) {
    this.selectedTabIndex = index;
    const selectedTabId = this.metricTabs[index]?.id;
    if (selectedTabId) {
      this.eventSummaryTabsLocalStorageService.setLastSelectedStatsTabId(selectedTabId);
    }
    this.scheduleTabBodyHeightSync();
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
    const diffStart = performance.now();
    this.showDiff = !!this.event?.isMerge && this.selectedActivities.length === 2;
    if (!this.showDiff || !this.unitSettings) {
      this.diffByType = new Map();
      this.logPerf('update_diff_map', diffStart, { showDiff: false });
      return;
    }
    this.diffByType = this.buildDiffMap();
    this.logPerf('update_diff_map', diffStart, { showDiff: true, diffCount: this.diffByType.size });
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
    this.setupTabBodyResizeObserver();
    this.scheduleTabBodyHeightSync();
  }

  private scheduleTabBodyHeightSync() {
    if (this.isMobileViewport()) {
      this.clearTabBodyMinHeight();
      this.lastAppliedMinHeightPx = 0;
      return;
    }

    if (this.measureRafId !== null) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.syncTabBodyHeight();
      return;
    }

    this.measureRafId = requestAnimationFrame(() => {
      this.measureRafId = null;
      this.syncTabBodyHeight();
    });
  }

  private syncTabBodyHeight() {
    if (this.isMobileViewport()) {
      this.clearTabBodyMinHeight();
      this.lastAppliedMinHeightPx = 0;
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

    const maxHeight = Array.from(tabBodyContents).reduce((currentMax, tabBodyContent) => {
      return Math.max(currentMax, Math.ceil(tabBodyContent.scrollHeight));
    }, 0);

    if (maxHeight === this.lastAppliedMinHeightPx) {
      return;
    }

    this.lastAppliedMinHeightPx = maxHeight;
    tabGroupElement.style.setProperty('--summary-tabs-body-min-height', `${maxHeight}px`);
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

    const tabBodyContents = tabGroupElement.querySelectorAll<HTMLElement>('.mat-mdc-tab-body-content');
    if (!tabBodyContents.length) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleTabBodyHeightSync();
    });
    tabBodyContents.forEach((tabBodyContent) => {
      this.resizeObserver?.observe(tabBodyContent);
    });
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
      return;
    }

    cancelAnimationFrame(this.measureRafId);
    this.measureRafId = null;
  }

  private clearTabBodyMinHeight() {
    const tabGroupElement = this.summaryTabGroupRef?.nativeElement;
    tabGroupElement?.style.removeProperty('--summary-tabs-body-min-height');
  }

  private onMobileViewportChange() {
    this.cancelScheduledTabBodyHeightSync();
    this.lastAppliedMinHeightPx = 0;

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
    this.logger.info(`[perf] event_card_stats_grid_${step}`, {
      durationMs: Number((performance.now() - start).toFixed(2)),
      ...(meta || {}),
    });
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
