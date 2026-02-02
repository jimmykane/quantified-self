import { TestBed } from '@angular/core/testing';
import { EventDevicesService, INVALID_SERIAL } from './event-devices.service';
import { ActivityInterface } from '@sports-alliance/sports-lib';

describe('EventDevicesService', () => {
    let service: EventDevicesService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [EventDevicesService]
        });
        service = TestBed.inject(EventDevicesService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('groupDevices', () => {
        it('should group devices by serial number', () => {
            const rawDevices = [
                { type: 'heart_rate', serialNumber: 12345, manufacturer: 'garmin' },
                { type: 'heart_rate', serialNumber: 12345, batteryLevel: 80 }
            ];

            const groups = service['groupDevices'](rawDevices); // Accessing private for unit test convenience or use public API
            expect(groups.length).toBe(1);
            expect(groups[0].serialNumber).toBe(12345);
            expect(groups[0].batteryLevel).toBe(80);
            expect(groups[0].occurrences).toBe(2);
        });

        it('should group devices by signature fallback when serial is missing', () => {
            const rawDevices = [
                { type: 'cadence', manufacturer: 'wahoo', productId: 10 },
                { type: 'cadence', manufacturer: 'wahoo', productId: 10, batteryLevel: 50 },
                { type: 'cadence', manufacturer: 'garmin', productId: 20 } // Different mfg
            ];

            const groups = service['groupDevices'](rawDevices);
            expect(groups.length).toBe(2);

            const wahooGroup = groups.find(g => g.manufacturer === 'wahoo');
            expect(wahooGroup).toBeDefined();
            expect(wahooGroup?.occurrences).toBe(2);

            const garminGroup = groups.find(g => g.manufacturer === 'garmin');
            expect(garminGroup).toBeDefined();
            expect(garminGroup?.occurrences).toBe(1);
        });

        it('should handle INVALID_SERIAL correctly by keeping it', () => {
            // The requirement was to show it as "Invalid (4294967295)"
            const rawDevices = [
                { type: 'heart_rate', serialNumber: INVALID_SERIAL, manufacturer: 'garmin' }
            ];

            const groups = service['groupDevices'](rawDevices);
            expect(groups.length).toBe(1);
            expect(groups[0].serialNumber).toBe(INVALID_SERIAL);
        });
    });

    describe('getDetailEntries', () => {
        it('should format valid serial number correctly', () => {
            const group: any = { serialNumber: 12345 };
            const entries = service.getDetailEntries(group);
            const serialEntry = entries.find(e => e.label === 'Serial Number');
            expect(serialEntry?.value).toBe('12345');
        });

        it('should format INVALID_SERIAL as "Invalid (...)"', () => {
            const group: any = { serialNumber: INVALID_SERIAL };
            const entries = service.getDetailEntries(group);
            const serialEntry = entries.find(e => e.label === 'Serial Number');
            expect(serialEntry?.value).toBe(`Invalid (${INVALID_SERIAL})`);
        });
    });

    describe('categorization', () => {
        it('should categorize local source as main', () => {
            const groups = service['groupDevices']([{ sourceType: 'local', type: 'unknown' }]);
            expect(groups[0].category).toBe('main');
            expect(service.getCategoryIcon('main')).toBe('watch');
        });

        it('should categorize heart_rate as hr', () => {
            const groups = service['groupDevices']([{ type: 'heart_rate', manufacturer: 'polar' }]);
            expect(groups[0].category).toBe('hr');
            expect(service.getCategoryIcon('hr')).toBe('monitor_heart');
        });

        it('should categorize shifting devices', () => {
            const groups = service['groupDevices']([{ type: 'shifting', manufacturer: 'sram' }]);
            expect(groups[0].category).toBe('shifting');
            expect(service.getCategoryIcon('shifting')).toBe('settings');
        });

        it('should categorize di2 as shifting', () => {
            const groups = service['groupDevices']([{ type: 'di2', manufacturer: 'shimano' }]);
            expect(groups[0].category).toBe('shifting');
        });
    });
});
