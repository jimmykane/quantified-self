import {ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges} from '@angular/core';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {Privacy} from '@sports-alliance/sports-lib/lib/privacy/privacy.class.interface';
import {EventService} from '../../services/app.event.service';
import {MatSnackBar} from '@angular/material/snack-bar';
import {DataFeeling, Feelings} from '@sports-alliance/sports-lib/lib/data/data.feeling';
import {isNumber} from '@sports-alliance/sports-lib/lib/events/utilities/helpers';
import {DataRPE, RPEBorgCR10SCale} from '@sports-alliance/sports-lib/lib/data/data.rpe';
import {EnumeratorHelpers} from '../../helpers/enumerator-helpers';

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
  }


  async toggleEventPrivacy() {
    if (!this.user) {
      return
    }
    return this.eventService.setEventPrivacy(this.user, this.event.getID(), this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private);
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    await this.eventService.writeAllEventData(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventFeeling(feeling: Feelings, event: EventInterface) {
    if (!isNumber(feeling)) {
      return;
    }
    event.addStat(new DataFeeling(feeling));
    await this.eventService.writeAllEventData(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventRPE(rpe: RPEBorgCR10SCale, event: EventInterface) {
    if (!isNumber(rpe)) {
      return;
    }
    event.addStat(new DataRPE(rpe));
    await this.eventService.writeAllEventData(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }
}
