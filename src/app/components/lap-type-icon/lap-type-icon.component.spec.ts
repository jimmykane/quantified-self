import { LapTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { LapTypeIconComponent } from './lap-type-icon.component';

describe('LapTypeIconComponent', () => {
  it('should provide a distinct icon mapping for each lap type', () => {
    const component = new LapTypeIconComponent();

    expect(component.getColumnHeaderIcon(LapTypes.Distance)).toBe('straighten');
    expect(component.getColumnHeaderIcon(LapTypes.Unknown)).toBe('help');
    expect(component.getColumnHeaderIcon(LapTypes.AutoLap)).toBe('autorenew');
    expect(component.getColumnHeaderIcon(LapTypes.Location)).toBe('pin_drop');
    expect(component.getColumnHeaderIcon(LapTypes.Time)).toBe('schedule');
    expect(component.getColumnHeaderIcon(LapTypes.Manual)).toBe('touch_app');
    expect(component.getColumnHeaderIcon(LapTypes.Interval)).toBe('pace');
    expect(component.getColumnHeaderIcon(LapTypes.FitnessEquipment)).toBe('fitness_center');
  });
});
