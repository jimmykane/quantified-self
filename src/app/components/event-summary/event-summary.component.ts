import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { EventInterface, User, ActivityInterface, UserUnitSettingsInterface, Privacy } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { EventDetailsSummaryBottomSheetComponent } from './event-details-summary-bottom-sheet/event-details-summary-bottom-sheet.component';
import { EventStatsBottomSheetComponent } from '../event/stats-table/event-stats-bottom-sheet/event-stats-bottom-sheet.component';
import { EventDevicesBottomSheetComponent } from '../event/devices/event-devices-bottom-sheet/event-devices-bottom-sheet.component';

@Component({
  selector: 'app-event-summary',
  templateUrl: './event-summary.component.html',
  styleUrls: ['./event-summary.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventSummaryComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() showType = true;
  @Input() showIcon = false;
  @Input() isOwner = false;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() unitSettings: UserUnitSettingsInterface;
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
    await this.eventService.setEventPrivacy(this.user, this.event.getID(), this.event.privacy);
  }

  openEditDetails() {
    this.bottomSheet.open(EventDetailsSummaryBottomSheetComponent, {
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

  get hasDevices(): boolean {
    return this.selectedActivities?.some(a => a.creator?.devices?.length > 0);
  }

  openDevices() {
    this.bottomSheet.open(EventDevicesBottomSheetComponent, {
      data: {
        event: this.event,
        selectedActivities: this.selectedActivities,
      },
      panelClass: 'qs-full-width-bottom-sheet'
    });
  }
}
