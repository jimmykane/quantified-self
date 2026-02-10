import {
  DataAltitudeAvg,
  DataCadenceMax,
  DataCadenceMin,
  DataFeeling,
  DataPowerMax,
  DataPowerMin,
  DataRPE,
  DataTemperatureMax,
  DataTemperatureMin
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { DataTypeIconComponent } from './data-type-icon.component';

describe('DataTypeIconComponent', () => {
  it('should return icons for newly surfaced max/min metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataPowerMax.type)).toBe('bolt');
    expect(component.getColumnHeaderIcon(DataPowerMin.type)).toBe('bolt');
    expect(component.getColumnHeaderIcon(DataCadenceMax.type)).toBe('cached');
    expect(component.getColumnHeaderIcon(DataCadenceMin.type)).toBe('cached');
    expect(component.getColumnHeaderIcon(DataTemperatureMax.type)).toBe('device_thermostat');
    expect(component.getColumnHeaderIcon(DataTemperatureMin.type)).toBe('device_thermostat');
    expect(component.getColumnHeaderIcon(DataAltitudeAvg.type)).toBe('vertical_align_center');
  });

  it('should return icons for physiological subjective metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataFeeling.type)).toBe('mood');
    expect(component.getColumnHeaderIcon(DataRPE.type)).toBe('fitness_center');
  });
});
