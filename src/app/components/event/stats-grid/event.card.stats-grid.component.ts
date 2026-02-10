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
} from '../../../constants/event-summary-metric-groups';
import { buildSummaryMetricTabs, SummaryMetricTab } from '../../../helpers/summary-metric-tabs.helper';
import { expandStatsTypesForCompositeDiff } from '../../../helpers/header-stats-composite.helper';

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

  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private eventColorService = inject(AppEventColorService);
  private logger = inject(LoggerService);

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
    if ((this.selectedActivities.length === 1 && this.event.getActivities().length === 1)
      || this.selectedActivities.length === this.event.getActivities().length) {
      this.stats = [...this.event.getStats().values()];
    } else if (this.selectedActivities.length === 1) {
      this.stats = [...this.selectedActivities[0].getStats().values()];

    } else {
      this.stats = ActivityUtilities.getSummaryStatsForActivities(this.selectedActivities);
    }
    this.logPerf('build_stats', statsBuildStart, {
      selectedActivities: this.selectedActivities.length,
      statsCount: this.stats.length,
      eventId: this.event?.getID?.(),
    });

    if (this.statsToShow) {
      this.displayedStatsToShow = this.statsToShow;
      this.updateTabs();
      this.updateDiffMap();
      this.logPerf('ng_on_changes_total', ngChangesStart, { usedStatsOverride: true });
      return;
    }

    const activityTypes = (this.selectedActivities || []).map((activity: ActivityInterface) => activity.type).filter(type => !!type) as ActivityTypes[];

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

    const defaultTabIndex = this.metricTabs.findIndex((tab) => {
      return tab.id === EVENT_SUMMARY_DEFAULT_GROUP_ID;
    });

    this.selectedTabIndex = defaultTabIndex >= 0 ? defaultTabIndex : 0;
  }

  private logPerf(step: string, start: number, meta?: Record<string, unknown>) {
    this.logger.info(`[perf] event_card_stats_grid_${step}`, {
      durationMs: Number((performance.now() - start).toFixed(2)),
      ...(meta || {}),
    });
  }
}
