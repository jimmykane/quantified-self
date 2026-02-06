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
  public showDiff = false;
  public diffByType = new Map<string, { display: string; percent: number; color: string }>();

  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private eventColorService = inject(AppEventColorService);

  public get unitSettings() {
    return this.userSettingsQuery.unitSettings();
  }

  public get summariesSettings() {
    return this.userSettingsQuery.summariesSettings();
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    if (!this.selectedActivities.length) {
      this.stats = [];
      this.showDiff = false;
      this.diffByType = new Map();
      return;
    }

    if ((this.selectedActivities.length === 1 && this.event.getActivities().length === 1)
      || this.selectedActivities.length === this.event.getActivities().length) {
      this.stats = [...this.event.getStats().values()];
    } else if (this.selectedActivities.length === 1) {
      this.stats = [...this.selectedActivities[0].getStats().values()];

    } else {
      this.stats = ActivityUtilities.getSummaryStatsForActivities(this.selectedActivities);
    }

    if (this.statsToShow) {
      this.displayedStatsToShow = this.statsToShow;
      this.updateDiffMap();
      return;
    }

    const activityTypes = (this.selectedActivities || []).map((activity: ActivityInterface) => activity.type).filter(type => !!type) as ActivityTypes[];

    // the order here is important
    this.displayedStatsToShow = getDefaultSummaryStatTypes(activityTypes, this.summariesSettings);

    this.updateDiffMap();
  }

  private updateDiffMap() {
    this.showDiff = !!this.event?.isMerge && this.selectedActivities.length === 2;
    if (!this.showDiff || !this.unitSettings) {
      this.diffByType = new Map();
      return;
    }
    this.diffByType = this.buildDiffMap();
  }

  private buildDiffMap(): Map<string, { display: string; percent: number; color: string }> {
    const diffMap = buildDiffMapForStats(this.stats, this.displayedStatsToShow, this.selectedActivities, this.unitSettings);
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
}
