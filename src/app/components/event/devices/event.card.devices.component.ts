import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataDistance } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-event-card-devices',
  templateUrl: './event.card.devices.component.html',
  styleUrls: ['./event.card.devices.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardDevicesComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];

  public dataSourcesMap = new Map<string, MatTableDataSource<any>>();
  public columnsMap = new Map<string, string[]>();

  ngOnChanges() {
    this.updateData();
  }

  private updateData() {
    this.dataSourcesMap.clear();
    this.columnsMap.clear();

    if (!this.selectedActivities) {
      return;
    }

    this.selectedActivities.forEach(activity => {
      const data = this.generateDeviceData(activity);
      if (data.length > 0) {
        const dataSource = new MatTableDataSource(data);
        this.dataSourcesMap.set(activity.getID(), dataSource);
        this.columnsMap.set(activity.getID(), this.calculateColumns(dataSource));
      }
    });
  }

  private calculateColumns(dataSource: MatTableDataSource<any>): string[] {
    // Only show columns that have at least one non-empty value
    const allPossibleColumns = Object.keys(dataSource.data[0]);
    return allPossibleColumns.filter(column => {
      return dataSource.data.find(row => {
        const val = row[column];
        return val !== undefined && val !== null && val !== '';
      });
    });
  }

  private generateDeviceData(activity: ActivityInterface) {
    return activity.creator.devices.reduce((deviceDataArray, device, index) => {
      const deviceObject = {
        '#': index + 1,
        'Type': device.type,
        'Name': device.name,
        'Battery Status': device.batteryStatus,
        'Battery Level': device.batteryLevel,
        'Battery Voltage': device.batteryVoltage,
        'Manufacturer': device.manufacturer,
        'Serial Number': device.serialNumber,
        'Product I. D.': device.product,
        'Software Info': device.swInfo,
        'Hardware Info': device.hwInfo,
        'Ant Device Number': device.antDeviceNumber,
        'Ant Transmission Type': device.antTransmissionType,
        'Ant Network': device.antNetwork,
        'Source Type': device.sourceType,
        'Cumulative Operating Time': device.cumOperatingTime,
      };

      deviceDataArray.push(deviceObject);
      return deviceDataArray;
    }, [] as any[]);
  }

  getDataSource(activity: ActivityInterface): MatTableDataSource<any> | undefined {
    return this.dataSourcesMap.get(activity.getID());
  }

  getColumns(activity: ActivityInterface): string[] {
    return this.columnsMap.get(activity.getID()) || [];
  }
}
