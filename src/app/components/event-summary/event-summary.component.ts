import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef, computed } from '@angular/core';
import {
  EventInterface,
  User,
  ActivityInterface,
  UserUnitSettingsInterface,
  Privacy,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataPowerAvg,
  DataFeeling,
  DataRPE,
  Feelings,
  RPEBorgCR10SCale,
  ActivityTypes,
  ActivityTypesHelper,
  ActivityTypeGroups
} from '@sports-alliance/sports-lib';
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
    if (!this.user || !this.event.getID()) {
      return
    }
    // Optimistically toggle locally
    this.event.privacy = this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private;
    this.cd.markForCheck(); // Trigger detection immediately

    // Then call service
    await this.eventService.setEventPrivacy(this.user, this.event.getID()!, this.event.privacy);
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
    return this.selectedActivities?.some(a =>
      a.creator?.devices?.some(d => d.name || d.manufacturer)
    ) ?? false;
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

  get mainActivityType(): string {
    return this.event?.getActivities()[0]?.type || 'Other';
  }

  getHeroStats(): string[] {
    const type = this.mainActivityType;
    if (type === 'Virtual Cycling' || type === 'VirtualRide') {
      return [DataDuration.type, DataPowerAvg.type];
    }
    const activityTypeEnum = ActivityTypes[type as keyof typeof ActivityTypes] || (Object.values(ActivityTypes).includes(type as ActivityTypes) ? type as ActivityTypes : ActivityTypes.Other);
    const group = ActivityTypesHelper.getActivityGroupForActivityType(activityTypeEnum);

    switch (group) {
      case ActivityTypeGroups.IndoorSports:
        return [DataDuration.type, DataEnergy.type];
      case ActivityTypeGroups.Running:
      case ActivityTypeGroups.TrailRunning:
      case ActivityTypeGroups.Cycling:
      case ActivityTypeGroups.Swimming:
      case ActivityTypeGroups.OutdoorAdventures:
      case ActivityTypeGroups.WinterSports:
      case ActivityTypeGroups.WaterSports:
      case ActivityTypeGroups.Performance:
      default:
        return [DataDistance.type, DataDuration.type];
    }
  }

  getStatValue(statType: string): string {
    const stat = this.event?.getStat(statType);
    return stat ? String(stat.getDisplayValue()) : '--';
  }

  getStatUnit(statType: string): string {
    const stat = this.event?.getStat(statType);
    return stat ? stat.getDisplayUnit() : '';
  }

  get feeling(): Feelings | null {
    const stat = this.event?.getStat(DataFeeling.type) as DataFeeling;
    return stat ? stat.getValue() as Feelings : null;
  }

  get feelingLabel(): string {
    const f = this.feeling;
    if (f === null) return '';
    return Feelings[f] || '';
  }

  get rpe(): RPEBorgCR10SCale | null {
    const stat = this.event?.getStat(DataRPE.type) as DataRPE;
    return stat ? stat.getValue() as RPEBorgCR10SCale : null;
  }

  get rpeLabel(): string {
    const r = this.rpe;
    if (r === null) return '';
    return RPEBorgCR10SCale[r] || '';
  }

  get feelingEmoji(): string {
    const f = this.feeling;
    if (f === null) return '';
    const emojiMap: { [key: number]: string } = {
      [Feelings.Excellent]: '🤩',
      [Feelings['Very Good']]: '😊',
      [Feelings.Good]: '😌',
      [Feelings.Average]: '😐',
      [Feelings.Poor]: '😕',
    };
    return emojiMap[f] || '';
  }
}
