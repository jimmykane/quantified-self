import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';

/**
 * Represents a consolidated group of device entries.
 */
export interface DeviceGroup {
  signature: string;
  type: string;
  displayName: string;
  manufacturer: string;
  serialNumber: number | string | null;
  productId: number | null;
  softwareInfo: number | string | null;
  hardwareInfo: number | string | null;
  batteryStatus: string | null;
  batteryLevel: number | null;
  batteryVoltage: number | null;
  antNetwork: string | null;
  sourceType: string | null;
  cumulativeOperatingTime: number | null;
  occurrences: number;
  category: 'main' | 'power' | 'hr' | 'other';
}

/** Invalid serial number (0xFFFFFFFF) used by FIT protocol as default. */
const INVALID_SERIAL = 4294967295;

/** Known power/cadence manufacturers */
const POWER_MANUFACTURERS = ['sram', 'quarq', 'stages', 'favero', 'garmin', 'shimano', 'pioneer', 'power2max', 'srm', '4iiii'];

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

  public deviceGroupsMap = new Map<string, DeviceGroup[]>();

  ngOnChanges() {
    this.updateData();
  }

  private updateData() {
    this.deviceGroupsMap.clear();

    if (!this.selectedActivities) {
      return;
    }

    this.selectedActivities.forEach(activity => {
      const rawDevices = this.extractRawDevices(activity);
      const groups = this.groupDevices(rawDevices);
      if (groups.length > 0) {
        this.deviceGroupsMap.set(activity.getID() ?? '', groups);
      }
    });
  }

  private extractRawDevices(activity: ActivityInterface): any[] {
    return activity.creator.devices.map(device => ({
      type: device.type === 'Unknown' ? '' : (device.type ?? ''),
      name: device.name ?? '',
      batteryStatus: device.batteryStatus ?? null,
      batteryLevel: device.batteryLevel ?? null,
      batteryVoltage: device.batteryVoltage ?? null,
      manufacturer: device.manufacturer ?? '',
      serialNumber: device.serialNumber ?? null,
      productId: device.product ?? null,
      softwareInfo: device.swInfo ?? null,
      hardwareInfo: device.hwInfo ?? null,
      antDeviceNumber: device.antDeviceNumber ?? null,
      antTransmissionType: device.antTransmissionType ?? null,
      antNetwork: device.antNetwork ?? null,
      sourceType: device.sourceType ?? null,
      cumulativeOperatingTime: device.cumOperatingTime ?? null,
    }));
  }

  private groupDevices(devices: any[]): DeviceGroup[] {
    const groupMap = new Map<string, DeviceGroup>();

    for (const device of devices) {
      // Skip entries with no useful info
      if (!this.hasUsefulInfo(device)) {
        continue;
      }

      const signature = this.createSignature(device);
      const existing = groupMap.get(signature);

      if (existing) {
        existing.occurrences++;
        // Merge: prefer values that have more info
        this.mergeDeviceData(existing, device);
      } else {
        groupMap.set(signature, this.createDeviceGroup(device, signature));
      }
    }

    // Convert to array and sort by category priority
    const groups = Array.from(groupMap.values());
    return this.sortByCategory(groups);
  }

  private hasUsefulInfo(device: any): boolean {
    // Filter out entries that are just noise
    const hasValidSerial = device.serialNumber && device.serialNumber !== INVALID_SERIAL;
    const hasManufacturer = !!device.manufacturer;
    const hasBattery = device.batteryLevel != null || device.batteryVoltage != null;
    const hasType = !!device.type;

    return hasValidSerial || hasManufacturer || hasBattery || hasType;
  }

  private createSignature(device: any): string {
    // Create unique key from stable device properties
    const parts = [
      device.type || 'unknown',
      device.manufacturer || 'unknown',
      device.productId || 'unknown',
      (device.serialNumber && device.serialNumber !== INVALID_SERIAL) ? device.serialNumber : 'no-serial'
    ];
    return parts.join('-').toLowerCase();
  }

  private createDeviceGroup(device: any, signature: string): DeviceGroup {
    const type = device.type || '';
    const manufacturer = device.manufacturer || '';

    return {
      signature,
      type,
      displayName: this.generateDisplayName(device),
      manufacturer,
      serialNumber: device.serialNumber !== INVALID_SERIAL ? device.serialNumber : null,
      productId: device.productId,
      softwareInfo: device.softwareInfo,
      hardwareInfo: device.hardwareInfo,
      batteryStatus: device.batteryStatus,
      batteryLevel: device.batteryLevel,
      batteryVoltage: device.batteryVoltage,
      antNetwork: device.antNetwork,
      sourceType: device.sourceType,
      cumulativeOperatingTime: device.cumulativeOperatingTime,
      occurrences: 1,
      category: this.categorizeDevice(type, manufacturer, device.sourceType),
    };
  }

  private generateDisplayName(device: any): string {
    if (device.name) {
      return device.name;
    }

    const parts: string[] = [];

    if (device.manufacturer) {
      parts.push(this.capitalize(device.manufacturer));
    }

    if (device.type) {
      parts.push(this.formatType(device.type));
    }

    if (parts.length === 0 && device.productId) {
      parts.push(`Product ${device.productId}`);
    }

    return parts.join(' ') || 'Unknown Device';
  }

  private formatType(type: string): string {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  private categorizeDevice(type: string, manufacturer: string, sourceType: string): 'main' | 'power' | 'hr' | 'other' {
    const typeLower = (type || '').toLowerCase();
    const mfgLower = (manufacturer || '').toLowerCase();
    const srcLower = (sourceType || '').toLowerCase();

    // Main device: local source with manufacturer (usually the watch)
    if (srcLower === 'local' && mfgLower) {
      return 'main';
    }

    // Heart rate
    if (typeLower.includes('heart') || typeLower === 'hr' || typeLower === 'heart_rate') {
      return 'hr';
    }

    // Power/cadence sensors
    if (POWER_MANUFACTURERS.includes(mfgLower) || typeLower.includes('power') || typeLower.includes('cadence')) {
      return 'power';
    }

    return 'other';
  }

  private mergeDeviceData(existing: DeviceGroup, newDevice: any): void {
    // Prefer non-null values
    if (!existing.batteryLevel && newDevice.batteryLevel != null) {
      existing.batteryLevel = newDevice.batteryLevel;
    }
    if (!existing.batteryVoltage && newDevice.batteryVoltage != null) {
      existing.batteryVoltage = newDevice.batteryVoltage;
    }
    if (!existing.batteryStatus && newDevice.batteryStatus) {
      existing.batteryStatus = newDevice.batteryStatus;
    }
    if (!existing.softwareInfo && newDevice.softwareInfo != null) {
      existing.softwareInfo = newDevice.softwareInfo;
    }
    if (!existing.hardwareInfo && newDevice.hardwareInfo != null) {
      existing.hardwareInfo = newDevice.hardwareInfo;
    }
    if (!existing.cumulativeOperatingTime && newDevice.cumulativeOperatingTime != null) {
      existing.cumulativeOperatingTime = newDevice.cumulativeOperatingTime;
    }
  }

  private sortByCategory(groups: DeviceGroup[]): DeviceGroup[] {
    const priority: Record<string, number> = { main: 0, power: 1, hr: 2, other: 3 };
    return groups.sort((a, b) => priority[a.category] - priority[b.category]);
  }

  getDeviceGroups(activity: ActivityInterface): DeviceGroup[] {
    return this.deviceGroupsMap.get(activity.getID() ?? '') || [];
  }

  getCategoryIcon(category: string): string {
    switch (category) {
      case 'main': return 'watch';
      case 'power': return 'bolt';
      case 'hr': return 'favorite';
      default: return 'devices_other';
    }
  }

  getBatteryIcon(level: number | null): string {
    if (level == null) return 'battery_unknown';
    if (level >= 90) return 'battery_full';
    if (level >= 80) return 'battery_6_bar';
    if (level >= 60) return 'battery_5_bar';
    if (level >= 50) return 'battery_4_bar';
    if (level >= 30) return 'battery_3_bar';
    if (level >= 20) return 'battery_2_bar';
    if (level >= 10) return 'battery_1_bar';
    return 'battery_alert';
  }

  getBatteryColorClass(level: number | null): string {
    if (level == null) return '';
    if (level > 50) return 'battery-good';
    if (level > 20) return 'battery-medium';
    return 'battery-low';
  }

  getDetailEntries(group: DeviceGroup): { label: string; value: string; icon: string }[] {
    const entries: { label: string; value: string; icon: string }[] = [];

    if (group.serialNumber) {
      entries.push({ label: 'Serial Number', value: String(group.serialNumber), icon: 'fingerprint' });
    }
    if (group.productId) {
      entries.push({ label: 'Product ID', value: String(group.productId), icon: 'inventory_2' });
    }
    if (group.softwareInfo != null) {
      entries.push({ label: 'Software', value: String(group.softwareInfo), icon: 'terminal' });
    }
    if (group.hardwareInfo != null) {
      entries.push({ label: 'Hardware', value: String(group.hardwareInfo), icon: 'memory' });
    }
    if (group.antNetwork) {
      entries.push({ label: 'ANT Network', value: group.antNetwork, icon: 'settings_input_antenna' });
    }
    if (group.sourceType) {
      entries.push({ label: 'Source', value: group.sourceType.replace(/_/g, ' '), icon: 'source' });
    }
    if (group.cumulativeOperatingTime != null) {
      const hours = Math.round(group.cumulativeOperatingTime / 3600);
      entries.push({ label: 'Operating Time', value: `${hours}h`, icon: 'timer' });
    }
    if (group.batteryVoltage != null) {
      entries.push({ label: 'Battery Voltage', value: `${group.batteryVoltage.toFixed(2)}V`, icon: 'electric_bolt' });
    }

    return entries;
  }
}

