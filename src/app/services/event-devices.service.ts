import { Injectable } from '@angular/core';
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
    category: 'main' | 'power' | 'hr' | 'shifting' | 'other';
}

/** Invalid serial number (0xFFFFFFFF) used by FIT protocol as default. */
export const INVALID_SERIAL = 4294967295;

/** Known power/cadence manufacturers */
const POWER_MANUFACTURERS = ['sram', 'quarq', 'stages', 'favero', 'garmin', 'shimano', 'pioneer', 'power2max', 'srm', '4iiii'];

@Injectable({
    providedIn: 'root'
})
export class EventDevicesService {

    constructor() { }

    /**
     * Main entry point to get grouped devices for an activity.
     */
    public getDeviceGroups(activity: ActivityInterface): DeviceGroup[] {
        const rawDevices = this.extractRawDevices(activity);
        return this.groupDevices(rawDevices);
    }

    private extractRawDevices(activity: ActivityInterface): any[] {
        return activity.creator.devices.map(device => {
            return {
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
            };
        });
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
        // Priority 1: Group by Serial Number if it's valid
        if (device.serialNumber && Number(device.serialNumber) !== INVALID_SERIAL) {
            return `serial-${device.serialNumber}`;
        }

        // Priority 2: Fallback to composite key for devices without unique serials
        const parts = [
            device.type || 'unknown',
            device.manufacturer || 'unknown',
            device.productId || 'unknown'
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
            serialNumber: device.serialNumber,
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

        // If we have a type but no manufacturer, and we have a product ID, append it for specificity
        if (!device.manufacturer && device.productId && device.type) {
            // Optional: parts.push(`(#${device.productId})`); 
        }

        if (parts.length === 0 && device.productId) {
            parts.push(`Product ${device.productId}`);
        }

        return parts.join(' ') || 'Unknown Device';
    }

    public formatType(type: string): string {
        return type
            .replace(/_/g, ' ')
            .replace(/\\b\\w/g, c => c.toUpperCase());
    }

    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    private categorizeDevice(type: string, manufacturer: string, sourceType: string): 'main' | 'power' | 'hr' | 'shifting' | 'other' {
        const typeLower = (type || '').toLowerCase();
        const mfgLower = (manufacturer || '').toLowerCase();
        const srcLower = (sourceType || '').toLowerCase();

        // Main device: local source (usually the watch/computer)
        // Relaxed check: don't strictly require manufacturer, as some files might miss it
        if (srcLower === 'local') {
            return 'main';
        }

        // Heart rate
        if (typeLower.includes('heart') || typeLower === 'hr' || typeLower === 'heart_rate') {
            return 'hr';
        }

        // Shifting (Sram, Shimano Di2, Campagnolo, etc.)
        // Check for "shifting" keyword in type or name, or specific names
        if (typeLower.includes('shifting') || typeLower.includes('di2') || typeLower.includes('eps') || typeLower.includes('etap')) {
            return 'shifting';
        }

        // Power/cadence sensors
        if (POWER_MANUFACTURERS.includes(mfgLower) || typeLower.includes('power') || typeLower.includes('cadence')) {
            return 'power';
        }

        return 'other';
    }

    private mergeDeviceData(existing: DeviceGroup, newDevice: any): void {
        // Merge Identity Fields using score-based resolution for Type
        const newScore = this.getTypeScore(newDevice.type);
        const oldScore = this.getTypeScore(existing.type);

        if (newScore > oldScore) {
            existing.type = newDevice.type;
        }

        if ((!existing.manufacturer || existing.manufacturer === 'unknown') && newDevice.manufacturer) {
            existing.manufacturer = newDevice.manufacturer;
        }
        if (!existing.productId && newDevice.productId) {
            existing.productId = newDevice.productId;
        }

        // 2. Merge Technical / Battery Data (Prefer non-null)
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
        if (!existing.antNetwork && newDevice.antNetwork) {
            existing.antNetwork = newDevice.antNetwork;
        }

        // 3. Re-calculate derived properties based on merged data
        existing.displayName = this.generateDisplayName(existing);
        existing.category = this.categorizeDevice(existing.type, existing.manufacturer, existing.sourceType || '');
    }

    private sortByCategory(groups: DeviceGroup[]): DeviceGroup[] {
        const priority: Record<string, number> = { main: 0, power: 1, hr: 2, shifting: 3, other: 4 };
        return groups.sort((a, b) => priority[a.category] - priority[b.category]);
    }

    private getTypeScore(type: string | null): number {
        if (!type || type === 'unknown' || type === 'Unknown') return 0;

        const t = type.toLowerCase();

        // Transport protocols (low priority)
        if (t === 'antfs' || t === 'antplus' || t === 'bluetooth' || t === 'ble' || t === 'bluetooth_low_energy') {
            return 1;
        }

        // Specific sensors (high priority)
        return 10;
    }

    /**
     * UI Helpers that are often needed alongside device data
     */
    public getCategoryIcon(category: string): string {
        switch (category) {
            case 'main': return 'watch';
            case 'power': return 'bolt';
            case 'hr': return 'monitor_heart';
            case 'shifting': return 'settings'; // Gears/cogs
            default: return 'devices_other';
        }
    }

    public getBatteryIcon(level: number | null, status?: string | null): string {
        if (level != null) {
            if (level >= 90) return 'battery_full';
            if (level >= 80) return 'battery_6_bar';
            if (level >= 60) return 'battery_5_bar';
            if (level >= 50) return 'battery_4_bar';
            if (level >= 30) return 'battery_3_bar';
            if (level >= 20) return 'battery_2_bar';
            if (level >= 10) return 'battery_1_bar';
            return 'battery_alert';
        }

        if (status) {
            const s = status.toLowerCase();
            if (s === 'new' || s === 'good') return 'battery_full';
            if (s === 'ok') return 'battery_5_bar';
            if (s === 'low') return 'battery_2_bar';
            if (s === 'critical') return 'battery_alert';
        }

        return 'battery_unknown';
    }

    public getBatteryColorClass(level: number | null, status?: string | null): string {
        if (level != null) {
            if (level > 50) return 'battery-good';
            if (level > 20) return 'battery-medium';
            return 'battery-low';
        }

        if (status) {
            const s = status.toLowerCase();
            if (s === 'new' || s === 'good' || s === 'ok') return 'battery-good';
            if (s === 'low') return 'battery-medium';
            if (s === 'critical') return 'battery-low';
        }

        return '';
    }

    public getDetailEntries(group: DeviceGroup): { label: string; value: string; icon: string }[] {
        const entries: { label: string; value: string; icon: string }[] = [];

        if (group.serialNumber != null) {
            const displayValue = Number(group.serialNumber) === INVALID_SERIAL
                ? `Invalid (${group.serialNumber})`
                : String(group.serialNumber);
            entries.push({ label: 'Serial Number', value: displayValue, icon: 'fingerprint' });
        }
        if (group.type) {
            entries.push({ label: 'Type', value: this.formatType(group.type), icon: 'category' });
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
