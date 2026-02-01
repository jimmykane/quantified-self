import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataDistance } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';
import { DataInterface } from '@sports-alliance/sports-lib';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DataEnergy } from '@sports-alliance/sports-lib';
import { DataCadenceAvg } from '@sports-alliance/sports-lib';
import { DataPowerAvg } from '@sports-alliance/sports-lib';
import { DataAltitudeMax } from '@sports-alliance/sports-lib';
import { DataAltitudeMin } from '@sports-alliance/sports-lib';
import { DataVO2Max } from '@sports-alliance/sports-lib';
import { DataTemperatureAvg } from '@sports-alliance/sports-lib';
import { DataSpeedAvg } from '@sports-alliance/sports-lib';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { DataPeakEPOC } from '@sports-alliance/sports-lib';
import { DataAerobicTrainingEffect } from '@sports-alliance/sports-lib';
import { DataMovingTime } from '@sports-alliance/sports-lib';
import { DataRecoveryTime } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppEventUtilities } from '../../../utils/app.event.utilities';

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

  private userSettingsQuery = inject(AppUserSettingsQueryService);

  public get unitSettings() {
    return this.userSettingsQuery.unitSettings();
  }

  public get summariesSettings() {
    return this.userSettingsQuery.summariesSettings();
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    if (!this.selectedActivities.length) {
      this.stats = [];
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
      return;
    }

    const activityTypes = (this.selectedActivities || []).map((activity: ActivityInterface) => activity.type).filter(type => !!type) as ActivityTypes[];

    // the order here is important
    this.displayedStatsToShow = [
      DataDuration.type,
      DataMovingTime.type,
      DataDistance.type,
      DataSpeedAvg.type,
      DataEnergy.type,
      DataHeartRateAvg.type,
      DataCadenceAvg.type,
      DataPowerAvg.type,
      DataAscent.type,
      DataDescent.type,
      DataAltitudeMax.type,
      DataAltitudeMin.type,
      DataRecoveryTime.type,
      DataPeakEPOC.type,
      DataAerobicTrainingEffect.type,
      DataVO2Max.type,
      DataTemperatureAvg.type,
    ].reduce((statsAccu: string[], statType: string) => {
      if (statType === DataAscent.type) {
        if (AppEventUtilities.shouldExcludeAscent(activityTypes) || (this.summariesSettings?.removeAscentForEventTypes || []).some((type: string) => (activityTypes as string[]).includes(type))) {
          return statsAccu;
        }
      }
      if (statType === DataDescent.type) {
        if (AppEventUtilities.shouldExcludeDescent(activityTypes) || ((this.summariesSettings as any)?.removeDescentForEventTypes || []).some((type: string) => (activityTypes as string[]).includes(type))) {
          return statsAccu;
        }
      }
      if (statType === DataSpeedAvg.type) {
        const speedMetrics = activityTypes.reduce((speedMetricsAccu: string[], activityType: ActivityTypes) => {
          const metrics = ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(activityType);
          return [...new Set([...speedMetricsAccu, ...(metrics || [])]).values()];
        }, [] as string[]);
        return [...statsAccu, ...speedMetrics];
      }
      return [...statsAccu, statType];
    }, [] as string[])
  }
}
