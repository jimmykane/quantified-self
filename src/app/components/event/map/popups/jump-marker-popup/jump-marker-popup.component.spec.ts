import { describe, it, expect, vi } from 'vitest';
import { JumpMarkerPopupComponent } from './jump-marker-popup.component';

describe('JumpMarkerPopupComponent', () => {
    it('should return formatted hang time with milliseconds', () => {
        const component = new JumpMarkerPopupComponent();
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
        const component = new JumpMarkerPopupComponent();
        component.jump = {
            jumpData: {}
        } as any;

        expect(component.getFormattedHangTime()).toBe('-');
    });
});
