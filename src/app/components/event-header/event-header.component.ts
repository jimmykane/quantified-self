import {ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {User} from 'quantified-self-lib/lib/users/user';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {EventService} from '../../services/app.event.service';
import {MatSnackBar} from '@angular/material/snack-bar';
import {DataFeeling, Feelings} from 'quantified-self-lib/lib/data/data.feeling';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {DataRPE, RPEBorgCR10SCale} from 'quantified-self-lib/lib/data/data.rpe';
import {EnumeratorHelpers} from '../../helpers/enumerator-helpers';
import {DataDuration} from 'quantified-self-lib/lib/data/data.duration';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataHeartRateAvg} from 'quantified-self-lib/lib/data/data.heart-rate-avg';
import {DataSpeedAvg} from 'quantified-self-lib/lib/data/data.speed-avg';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import {DataPowerAvg} from 'quantified-self-lib/lib/data/data.power-avg';
import {ActivityTypes, ActivityTypesHelper} from 'quantified-self-lib/lib/activities/activity.types';
import {DataActivityTypes} from 'quantified-self-lib/lib/data/data.activity-types';
import {DataEnergy} from 'quantified-self-lib/lib/data/data.energy';
import {DataTemperatureAvg} from 'quantified-self-lib/lib/data/data.temperature-avg';
import {DataCadenceAvg} from 'quantified-self-lib/lib/data/data.cadence-avg';
import {DataRecovery} from 'quantified-self-lib/lib/data/data.recovery';
import {DataRecoveryTime} from 'quantified-self-lib/lib/data/dataRecoveryTime';

@Component({
  selector: 'app-event-header',
  templateUrl: './event-header.component.html',
  styleUrls: ['./event-header.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventHeaderComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() showType = true;
  @Input() showIcon = false;
  @Input() isOwner = false;


  public statsToShow = [
    DataDuration.type,
    DataDistance.type,
    DataHeartRateAvg.type,
    DataSpeedAvg.type,
    DataAscent.type,
    DataDescent.type,
    DataEnergy.type,
    DataCadenceAvg.type,
    DataPowerAvg.type,
    DataTemperatureAvg.type,
    DataRecoveryTime.type,
  ];

  feeling: Feelings;
  rpe: RPEBorgCR10SCale;
  feelings = EnumeratorHelpers.getNumericEnumKeyValue(Feelings);
  rpeBorgCR10SCale = EnumeratorHelpers.getNumericEnumKeyValue(RPEBorgCR10SCale);


  constructor(private eventService: EventService, private snackBar: MatSnackBar) {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.event) {
      return;
    }
    if (this.event.getStat(DataFeeling.type)) {
      this.feeling = (<DataFeeling>this.event.getStat(DataFeeling.type)).getValue();
    }
    if (this.event.getStat(DataRPE.type)) {
      this.rpe = (<DataRPE>this.event.getStat(DataRPE.type)).getValue();
    }

    const activityTypes = (<DataActivityTypes>this.event.getStat(DataActivityTypes.type)).getValue();

    this.statsToShow = this.statsToShow.reduce((statsAccu, statType) => {
      if (statType === DataSpeedAvg.type) {
        return [...statsAccu, ...activityTypes.reduce((speedMetricsAccu, activityType) => {
          return [...speedMetricsAccu, ...ActivityTypesHelper.averageSpeedDerivedMetricsToUseForActivityType(ActivityTypes[activityType])];
        }, [])];
      }
      return [...statsAccu, statType];
    }, []);

  }


  async toggleEventPrivacy() {
    if (!this.user) {
      return
    }
    return this.eventService.setEventPrivacy(this.user, this.event.getID(), this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private);
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    await this.eventService.setEvent(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventFeeling(feeling: Feelings, event: EventInterface) {
    if (!isNumber(feeling)) {
      return;
    }
    event.addStat(new DataFeeling(feeling));
    await this.eventService.setEvent(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventRPE(rpe: RPEBorgCR10SCale, event: EventInterface) {
    if (!isNumber(rpe)) {
      return;
    }
    event.addStat(new DataRPE(rpe));
    await this.eventService.setEvent(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }
}
