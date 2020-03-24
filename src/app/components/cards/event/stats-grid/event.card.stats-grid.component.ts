import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges} from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {ActivityInterface} from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import {DataDistance} from '@sports-alliance/sports-lib/lib/data/data.distance';
import {DataAscent} from '@sports-alliance/sports-lib/lib/data/data.ascent';
import {DataDescent} from '@sports-alliance/sports-lib/lib/data/data.descent';
import {DataHeartRateAvg} from '@sports-alliance/sports-lib/lib/data/data.heart-rate-avg';
import {LoadingAbstractDirective} from '../../../loading/loading-abstract.directive';
import {DataTableAbstractDirective} from '../../../data-table/data-table-abstract.directive';
import {DataInterface} from '@sports-alliance/sports-lib/lib/data/data.interface';
import {EventUtilities} from '@sports-alliance/sports-lib/lib/events/utilities/event.utilities';
import {DataActivityTypes} from '@sports-alliance/sports-lib/lib/data/data.activity-types';
import {DataDuration} from '@sports-alliance/sports-lib/lib/data/data.duration';
import {DataEnergy} from '@sports-alliance/sports-lib/lib/data/data.energy';
import {DataCadenceAvg} from '@sports-alliance/sports-lib/lib/data/data.cadence-avg';
import {DataPowerAvg} from '@sports-alliance/sports-lib/lib/data/data.power-avg';
import {DataAltitudeMax} from '@sports-alliance/sports-lib/lib/data/data.altitude-max';
import {DataAltitudeMin} from '@sports-alliance/sports-lib/lib/data/data.altitude-min';
import {DataRecoveryTime} from '@sports-alliance/sports-lib/lib/data/dataRecoveryTime';
import {DataVO2Max} from '@sports-alliance/sports-lib/lib/data/data.vo2-max';
import {DataTemperatureAvg} from '@sports-alliance/sports-lib/lib/data/data.temperature-avg';
import {DataSpeedAvg} from '@sports-alliance/sports-lib/lib/data/data.speed-avg';
import {ActivityTypes, ActivityTypesHelper} from '@sports-alliance/sports-lib/lib/activities/activity.types';
import {UserUnitSettingsInterface} from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import {DataPeakEPOC} from '@sports-alliance/sports-lib/lib/data/data.peak-epoc';
import {DataTotalTrainingEffect} from '@sports-alliance/sports-lib/lib/data/data.total-training-effect';
import { DataGradeAdjustedSpeed } from '@sports-alliance/sports-lib/lib/data/data.grade-adjusted-speed';
import { DataGradeAdjustedSpeedAvg } from '@sports-alliance/sports-lib/lib/data/data.grade-adjusted-speed-avg';
import { DataMovingTime } from '@sports-alliance/sports-lib/lib/data/data.moving-time';

@Component({
  selector: 'app-event-card-stats-grid',
  templateUrl: './event.card.stats-grid.component.html',
  styleUrls: ['./event.card.stats-grid.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardStatsGridComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Input() unitSettings?: UserUnitSettingsInterface;


  public statsToShow = [];
  public stats: DataInterface[];

  ngOnChanges() {
    if (!this.selectedActivities.length) {
      this.stats = [];
      return;
    }

    if ((this.selectedActivities.length === 1 && this.event.getActivities().length === 1)
      ||  this.selectedActivities.length === this.event.getActivities().length) {
      this.stats = [...this.event.getStats().values()];
    } else if (this.selectedActivities.length === 1) {
      this.stats = [...this.selectedActivities[0].getStats().values()];

    } else {
      this.stats = EventUtilities.getSummaryStatsForActivities(this.selectedActivities);
    }

    const activityTypes = (<DataActivityTypes>this.event.getStat(DataActivityTypes.type)).getValue();

    // the order here is important
    this.statsToShow = [
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
      DataTotalTrainingEffect.type,
      DataVO2Max.type,
      DataTemperatureAvg.type,
    ].reduce((statsAccu, statType) => {
      if (statType === DataSpeedAvg.type) {
        return [...statsAccu, ...activityTypes.reduce((speedMetricsAccu, activityType) => {
          return [...new Set( [...speedMetricsAccu, ...ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(ActivityTypes[activityType])]).values()];
        }, [])];
      }
      return [...statsAccu, statType];
    }, [])
  }
}
