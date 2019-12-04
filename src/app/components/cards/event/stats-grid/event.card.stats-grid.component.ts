import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges} from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import {DataHeartRateAvg} from 'quantified-self-lib/lib/data/data.heart-rate-avg';
import {LoadingAbstract} from '../../../loading/loading.abstract';
import {DataTableAbstract} from '../../../data-table/data-table.abstract';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {DataActivityTypes} from 'quantified-self-lib/lib/data/data.activity-types';
import {DataDuration} from 'quantified-self-lib/lib/data/data.duration';
import {DataEnergy} from 'quantified-self-lib/lib/data/data.energy';
import {DataCadenceAvg} from 'quantified-self-lib/lib/data/data.cadence-avg';
import {DataPowerAvg} from 'quantified-self-lib/lib/data/data.power-avg';
import {DataAltitudeMax} from 'quantified-self-lib/lib/data/data.altitude-max';
import {DataAltitudeMin} from 'quantified-self-lib/lib/data/data.altitude-min';
import {DataRecoveryTime} from 'quantified-self-lib/lib/data/dataRecoveryTime';
import {DataVO2Max} from 'quantified-self-lib/lib/data/data.vo2-max';
import {DataTemperatureAvg} from 'quantified-self-lib/lib/data/data.temperature-avg';
import {DataSpeedAvg} from 'quantified-self-lib/lib/data/data.speed-avg';
import {ActivityTypes, ActivityTypesHelper} from 'quantified-self-lib/lib/activities/activity.types';
import {UserUnitSettingsInterface} from 'quantified-self-lib/lib/users/user.unit.settings.interface';

@Component({
  selector: 'app-event-card-stats-grid',
  templateUrl: './event.card.stats-grid.component.html',
  styleUrls: ['./event.card.stats-grid.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardStatsGridComponent extends DataTableAbstract implements OnChanges {
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
    // @todo move to own component

    this.statsToShow = [
      DataDuration.type,
      DataDistance.type,
      DataEnergy.type,
      DataHeartRateAvg.type,
      DataCadenceAvg.type,
      DataPowerAvg.type,
      DataAscent.type,
      DataDescent.type,
      DataAltitudeMax.type,
      DataAltitudeMin.type,
      DataRecoveryTime.type,
      DataVO2Max.type,
      DataTemperatureAvg.type,
      DataSpeedAvg.type,
    ].reduce((statsAccu, statType) => {
      if (statType === DataSpeedAvg.type) {
        return [...statsAccu, ...activityTypes.reduce((speedMetricsAccu, activityType) => {
          return [...speedMetricsAccu, ...ActivityTypesHelper.averageSpeedDerivedMetricsToUseForActivityType(ActivityTypes[activityType])];
        }, [])];
      }
      return [...statsAccu, statType];
    }, [])
  }
}
