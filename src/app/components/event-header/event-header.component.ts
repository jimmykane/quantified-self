import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { EventInterface, User, ActivityInterface, UserUnitSettingsInterface, Privacy } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { EventDetailsBottomSheetComponent } from './event-details-bottom-sheet/event-details-bottom-sheet.component';
import { EventStatsBottomSheetComponent } from '../event/stats-table/event-stats-bottom-sheet/event-stats-bottom-sheet.component';

@Component({
  selector: 'app-event-header',
  templateUrl: './event-header.component.html',
  styleUrls: ['./event-header.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventHeaderComponent implements OnChanges {
  @Input() event!: EventInterface;
  @Input() user!: User;
  @Input() showType = true;
  @Input() showIcon = false;
  @Input() isOwner = false;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() unitSettings!: UserUnitSettingsInterface;
  @Input() statsToShow: string[] = [];

  constructor(
    private eventService: AppEventService,
    private snackBar: MatSnackBar,
    private cd: ChangeDetectorRef,
    private bottomSheet: MatBottomSheet
  ) {
  }

  ngOnChanges(changes: SimpleChanges): void {
  }

  async toggleEventPrivacy() {
    if (!this.user) {
      return
    }
    // Optimistically toggle locally
    this.event.privacy = this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private;
    this.cd.markForCheck(); // Trigger detection immediately

    // Then call service
    await this.eventService.setEventPrivacy(this.user, this.event.getID()!, this.event.privacy);
  }

  openEditDetails() {
    this.bottomSheet.open(EventDetailsBottomSheetComponent, {
      data: { event: this.event, user: this.user }
    });
  }

  openDetailedStats() {
    this.bottomSheet.open(EventStatsBottomSheetComponent, {
      data: {
        event: this.event,
        selectedActivities: this.selectedActivities,
        userUnitSettings: this.unitSettings
      },
      panelClass: 'qs-full-width-bottom-sheet'
    });
  }
}
