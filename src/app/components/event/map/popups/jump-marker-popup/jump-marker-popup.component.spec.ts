import { describe, it, expect, vi } from 'vitest';
import { JumpMarkerPopupComponent } from './jump-marker-popup.component';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';

describe('JumpMarkerPopupComponent', () => {
    it('should return formatted hang time with milliseconds', () => {
        const component = new JumpMarkerPopupComponent({ unitSettings: vi.fn().mockReturnValue({}) } as any);
        const getDisplayValue = vi.fn().mockReturnValue('01.7s');
        component.jump = {
            jumpData: {
                hang_time: {
                    getDisplayValue
                }
            }
        } as any;

        expect(component.getFormattedHangTime()).toBe('01.7s');
        expect(getDisplayValue).toHaveBeenCalledWith(false, true, true);
    });

    it('should return dash when hang time is missing', () => {
        const component = new JumpMarkerPopupComponent({ unitSettings: vi.fn().mockReturnValue({}) } as any);
        component.jump = {
            jumpData: {}
        } as any;

        expect(component.getFormattedHangTime()).toBe('-');
    });

    it('should return converted speed display using unit settings', () => {
        const component = new JumpMarkerPopupComponent({ unitSettings: vi.fn().mockReturnValue({ speedUnits: ['km/h'] }) } as any);
        const convertedSpeed = {
            getDisplayValue: vi.fn().mockReturnValue('15.4'),
            getDisplayUnit: vi.fn().mockReturnValue('km/h')
        };
        const conversionSpy = vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance')
            .mockReturnValue([convertedSpeed] as any);

        component.jump = {
            jumpData: {
                speed: {
                    getDisplayValue: vi.fn().mockReturnValue('9.6'),
                    getDisplayUnit: vi.fn().mockReturnValue('m/s')
                }
            }
        } as any;

        expect(component.getFormattedSpeed()).toBe('15.4 km/h');
        expect(conversionSpy).toHaveBeenCalled();
        conversionSpy.mockRestore();
    });

    it('should fallback to raw speed when conversion fails', () => {
        const component = new JumpMarkerPopupComponent({ unitSettings: vi.fn().mockReturnValue({}) } as any);
        const conversionSpy = vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance')
            .mockImplementation(() => { throw new Error('conversion failed'); });

        component.jump = {
            jumpData: {
                speed: {
                    getDisplayValue: vi.fn().mockReturnValue('9.6'),
                    getDisplayUnit: vi.fn().mockReturnValue('m/s')
                }
            }
        } as any;

        expect(component.getFormattedSpeed()).toBe('9.6 m/s');
        conversionSpy.mockRestore();
    });
});
