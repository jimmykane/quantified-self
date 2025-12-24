import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { EventInterface, User, ActivityInterface, UserUnitSettingsInterface, Privacy, DataFeeling, Feelings, isNumber, DataRPE, RPEBorgCR10SCale } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EnumeratorHelpers } from '../../helpers/enumerator-helpers';

@Component({
  selector: 'app-event-header',
  templateUrl: './event-header.component.html',
  styleUrls: ['./event-header.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventHeaderComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() showType = true;
  @Input() showIcon = false;
  @Input() isOwner = false;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() unitSettings: UserUnitSettingsInterface;
  @Input() statsToShow: string[] = [];

  feeling: Feelings;
  rpe: RPEBorgCR10SCale;
  feelings = EnumeratorHelpers.getNumericEnumKeyValue(Feelings);
  rpeBorgCR10SCale = EnumeratorHelpers.getNumericEnumKeyValue(RPEBorgCR10SCale);

  constructor(private eventService: AppEventService, private snackBar: MatSnackBar, private cd: ChangeDetectorRef) {
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
    // Optimistically toggle locally
    this.event.privacy = this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private;
    this.cd.markForCheck(); // Trigger detection immediately

    // Then call service
    await this.eventService.setEventPrivacy(this.user, this.event.getID(), this.event.privacy);
  }

  returnZero() {
    return 0;
  }

  async saveEventName(name: string, event: EventInterface) {
    event.description = name;
    await this.eventService.updateEventProperties(this.user, event.getID(), {
      name: event.name,
    });
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    await this.eventService.updateEventProperties(this.user, event.getID(), {
      description: event.description,
    });
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
