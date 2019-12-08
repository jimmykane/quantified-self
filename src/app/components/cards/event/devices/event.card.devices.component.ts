import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import {DataHeartRateAvg} from 'quantified-self-lib/lib/data/data.heart-rate-avg';

@Component({
  selector: 'app-event-card-devices',
  templateUrl: './event.card.devices.component.html',
  styleUrls: ['./event.card.devices.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardDevicesComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];

  ngOnChanges() {
  }

  getData(activity: ActivityInterface) {
    return new MatTableDataSource(activity.creator.devices.reduce((deviceDataArray, device, index) => {
      const deviceObject = {
        '#': index + 1,
        'Type': device.type,
        'Name': device.name,
        'Battery Status': device.batteryStatus,
        // 'batteryVoltage': device.batteryVoltage,
        'Manufacturer': device.manufacturer,
        // 'serialNumber': device.serialNumber,
        'Product I. D.': device.product,
        'Software Info': device.swInfo,
        // 'hwInfo': device.hwInfo,
        'Ant Device Number': device.antDeviceNumber,
        // 'antTransmissionType': device.antTransmissionType,
        // 'antNetwork': device.antNetwork,
        // 'sourceType': device.sourceType,
        // 'cumOperatingTime': device.cumOperatingTime,
      };

      deviceDataArray.push(deviceObject);
      return deviceDataArray;
    }, []));
  }

  getColumns(activity) {
    return Object.keys(this.getData(activity).data[0]);
  }
}
