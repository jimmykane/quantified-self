import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DeviceGroup, EventDevicesService } from '../../../services/event-devices.service';

@Component({
  selector: 'app-event-card-devices',
  templateUrl: './event.card.devices.component.html',
  styleUrls: ['./event.card.devices.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventCardDevicesComponent implements OnChanges {
  @Input() event!: EventInterface;
  @Input() selectedActivities!: ActivityInterface[];

  public deviceGroupsMap = new Map<string, DeviceGroup[]>();

  constructor(private eventDevicesService: EventDevicesService) { }

  ngOnChanges() {
    this.updateData();
  }

  private updateData() {
    this.deviceGroupsMap.clear();

    if (!this.selectedActivities) {
      return;
    }

    this.selectedActivities.forEach(activity => {
      const groups = this.eventDevicesService.getDeviceGroups(activity);
      if (groups.length > 0) {
        this.deviceGroupsMap.set(activity.getID() ?? '', groups);
      }
    });
  }

  getDeviceGroups(activity: ActivityInterface): DeviceGroup[] {
    return this.deviceGroupsMap.get(activity.getID() ?? '') || [];
  }

  getCategoryIcon(category: string): string {
    return this.eventDevicesService.getCategoryIcon(category);
  }

  getBatteryIcon(level: number | null, status?: string | null): string {
    return this.eventDevicesService.getBatteryIcon(level, status);
  }

  getBatteryColorClass(level: number | null, status?: string | null): string {
    return this.eventDevicesService.getBatteryColorClass(level, status);
  }

  getDetailEntries(group: DeviceGroup): { label: string; value: string; icon: string }[] {
    return this.eventDevicesService.getDetailEntries(group);
  }
}

