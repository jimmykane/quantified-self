import {
  DataAscent,
  DataAltitudeAvg,
  DataCadenceMax,
  DataCadenceMin,
  DataDescent,
  DataFeeling,
  DataPowerMax,
  DataPowerMin,
  DataRPE,
  DataTemperatureMax,
  DataTemperatureMin
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { EVENT_SUMMARY_METRIC_GROUPS } from '../../constants/event-summary-metric-groups';
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

  it('should map ascent and descent to elevation', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataAscent.type)).toBe('elevation');
    expect(component.getColumnHeaderIcon(DataDescent.type)).toBe('elevation');
  });

  it('should return mirror class for descent only', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIconClass(DataDescent.type)).toBe('icon-mirror-x');
    expect(component.getColumnHeaderIconClass(DataAscent.type)).toBeNull();
  });

  it('should provide icon mappings for all configured performance tab metrics', () => {
    const component = new DataTypeIconComponent();
    const performanceGroup = EVENT_SUMMARY_METRIC_GROUPS.find((group) => group.id === 'performance');
    const performanceMetricTypes = performanceGroup?.metricTypes || [];

    expect(performanceMetricTypes.length).toBeGreaterThan(0);
    performanceMetricTypes.forEach((metricType) => {
      expect(component.getColumnHeaderIcon(metricType) || component.getColumnHeaderSVGIcon(metricType)).toBeTruthy();
    });
  });

  it('should provide icon mappings for ascent and descent time', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Ascent Time')).toBe('elevation');
    expect(component.getColumnHeaderIcon('Descent Time')).toBe('elevation');
  });
});
