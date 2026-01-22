import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';

/**
 * Maps safe column keys (used for matColumnDef and CSS) to display names (used for labels and icons).
 */
const COLUMN_MAPPING: Record<string, string> = {
  id: '#',
  type: 'Type',
  name: 'Name',
  batteryStatus: 'Battery Status',
  batteryLevel: 'Battery Level',
  batteryVoltage: 'Battery Voltage',
  manufacturer: 'Manufacturer',
  serialNumber: 'Serial Number',
  productId: 'Product ID',
  softwareInfo: 'Software Info',
  hardwareInfo: 'Hardware Info',
  antDeviceNumber: 'Ant Device Number',
  antTransmissionType: 'Ant Transmission Type',
  antNetwork: 'Ant Network',
  sourceType: 'Source Type',
  cumulativeOperatingTime: 'Cumulative Operating Time',
};

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
        const columns = this.calculateColumns(dataSource);
        this.columnsMap.set(activity.getID(), columns);
      }
    });
  }

  private calculateColumns(dataSource: MatTableDataSource<any>): string[] {
    // Only show columns that have at least one non-empty value
    const allPossibleColumns = Object.keys(dataSource.data[0]);
    return allPossibleColumns.filter(column => {
      return dataSource.data.find(row => {
        const val = row[column];
        const isVisible = val !== undefined && val !== null && val !== '';
        return isVisible;
      });
    });
  }

  private generateDeviceData(activity: ActivityInterface) {
    return activity.creator.devices.reduce((deviceDataArray, device, index) => {
      const deviceObject = {
        id: index + 1,
        type: device.type === 'Unknown' ? '' : device.type,
        name: device.name,
        batteryStatus: device.batteryStatus,
        batteryLevel: device.batteryLevel,
        batteryVoltage: device.batteryVoltage,
        manufacturer: device.manufacturer,
        serialNumber: device.serialNumber,
        productId: device.product,
        softwareInfo: device.swInfo,
        hardwareInfo: device.hwInfo,
        antDeviceNumber: device.antDeviceNumber,
        antTransmissionType: device.antTransmissionType,
        antNetwork: device.antNetwork,
        sourceType: device.sourceType,
        cumulativeOperatingTime: device.cumOperatingTime,
      };

      deviceDataArray.push(deviceObject);
      return deviceDataArray;
    }, [] as any[]);
  }

  /**
   * Returns the display label for a column key.
   */
  getColumnLabel(columnKey: string): string {
    return COLUMN_MAPPING[columnKey] || columnKey;
  }

  getBatteryIcon(level: number): string {
    if (level >= 90) return 'battery_full';
    if (level >= 80) return 'battery_6_bar';
    if (level >= 60) return 'battery_5_bar';
    if (level >= 50) return 'battery_4_bar';
    if (level >= 30) return 'battery_3_bar';
    if (level >= 20) return 'battery_2_bar';
    if (level >= 10) return 'battery_1_bar';
    return 'battery_alert';
  }

  getBatteryColorClass(level: number): string {
    if (level > 50) return 'battery-good';
    if (level > 20) return 'battery-medium';
    return 'battery-low';
  }

  getDataSource(activity: ActivityInterface): MatTableDataSource<any> | undefined {
    return this.dataSourcesMap.get(activity.getID());
  }

  getColumns(activity: ActivityInterface): string[] {
    return this.columnsMap.get(activity.getID()) || [];
  }
}
