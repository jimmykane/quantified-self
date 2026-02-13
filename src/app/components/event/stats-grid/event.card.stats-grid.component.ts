import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
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
import {
  EVENT_SUMMARY_DEFAULT_GROUP_ID,
  EventSummaryMetricGroupId,
} from '../../../constants/event-summary-metric-groups';
import { buildSummaryMetricTabs, SummaryMetricTab } from '../../../helpers/summary-metric-tabs.helper';
import { expandStatsTypesForCompositeDiff } from '../../../helpers/header-stats-composite.helper';
import { AppEventSummaryTabsLocalStorageService } from '../../../services/storage/app.event-summary-tabs.local.storage.service';

@Component({
  selector: 'app-event-card-stats-grid',
  templateUrl: './event.card.stats-grid.component.html',
  styleUrls: ['./event.card.stats-grid.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardStatsGridComponent implements OnChanges {
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
  private readonly verticalSpeedRegex = /vertical speed/i;

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

  ngOnChanges(simpleChanges: SimpleChanges) {
    const ngChangesStart = performance.now();
    if (!this.selectedActivities.length) {
      this.displayedStatsToShow = [];
      this.stats = [];
      this.metricTabs = [];
      this.selectedTabIndex = 0;
      this.showDiff = false;
      this.diffByType = new Map();
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
      this.logVerticalSpeedDebug('stats_override');
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
    this.logVerticalSpeedDebug('default_summary_types');
    this.logPerf('ng_on_changes_total', ngChangesStart, { usedStatsOverride: false });
  }

  public onSelectedTabIndexChange(index: number) {
    this.selectedTabIndex = index;
    const selectedTabId = this.metricTabs[index]?.id;
    if (selectedTabId) {
      this.eventSummaryTabsLocalStorageService.setLastSelectedStatsTabId(selectedTabId);
    }
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

  private logVerticalSpeedDebug(source: 'default_summary_types' | 'stats_override') {
    const eventActivities = this.event?.getActivities?.() || [];
    const statsSource = this.getStatsSourceLabel(eventActivities.length);
    const eventVerticalSpeedStats = statsSource === 'event_stats'
      ? this.extractVerticalSpeedStats(this.getEventStats())
      : [];
    const selectedActivitiesVerticalSpeed = this.selectedActivities.map((activity, index) => ({
      index,
      activityType: activity?.type || '',
      verticalSpeedStats: this.extractVerticalSpeedStats(this.getStatsForActivity(activity)),
    }));

    const payload = {
      source,
      eventId: this.event?.getID?.(),
      isMerge: !!this.event?.isMerge,
      selectedActivitiesCount: this.selectedActivities.length,
      eventActivitiesCount: eventActivities.length,
      statsSource,
      requestedVerticalSpeedTypes: this.displayedStatsToShow.filter((type) => this.isVerticalSpeedType(type)),
      mergedVerticalSpeedStats: this.extractVerticalSpeedStats(this.stats),
      eventVerticalSpeedStats,
      selectedActivitiesVerticalSpeed,
      tabsVerticalSpeed: this.metricTabs
        .map((tab) => ({
          tabId: tab.id,
          tabLabel: tab.label,
          verticalMetricTypes: tab.metricTypes.filter((metricType) => this.isVerticalSpeedType(metricType)),
        }))
        .filter((tab) => tab.verticalMetricTypes.length > 0),
    };

    this.logger.info('[debug] event_summary_vertical_speed', payload);
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

  private extractVerticalSpeedStats(stats: DataInterface[]): Array<{ type: string; displayType: string; displayValue: string; displayUnit: string }> {
    return (stats || [])
      .filter((stat) => this.isVerticalSpeedType(this.getStatType(stat)))
      .map((stat) => ({
        type: this.getStatType(stat),
        displayType: this.getSafeDisplayType(stat),
        displayValue: this.getSafeDisplayValue(stat),
        displayUnit: this.getSafeDisplayUnit(stat),
      }));
  }

  private isVerticalSpeedType(type: string): boolean {
    return !!type && this.verticalSpeedRegex.test(type);
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
