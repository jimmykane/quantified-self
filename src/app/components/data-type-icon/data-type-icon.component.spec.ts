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

  it('should provide icon mappings for requested environment metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Average Absolute Pressure')).toBe('compress');
    expect(component.getColumnHeaderIcon('Minimum Absolute Pressure')).toBe('compress');
    expect(component.getColumnHeaderIcon('Maximum Absolute Pressure')).toBe('compress');
    expect(component.getColumnHeaderIcon('Average Grade')).toBe('landscape');
    expect(component.getColumnHeaderIcon('Minimum Grade')).toBe('landscape');
    expect(component.getColumnHeaderIcon('Maximum Grade')).toBe('landscape');
  });

  it('should provide icon mappings for requested performance run-dynamics metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Average Ground Contact Time')).toBe('directions_walk');
    expect(component.getColumnHeaderIcon('Minimum Ground Contact Time')).toBe('directions_walk');
    expect(component.getColumnHeaderIcon('Maximum Ground Contact Time')).toBe('directions_walk');
    expect(component.getColumnHeaderIcon('Vertical Oscillation')).toBe('swap_vert');
    expect(component.getColumnHeaderIcon('Average Vertical Ratio')).toBe('show_chart');
    expect(component.getColumnHeaderIcon('Average Leg Stiffness')).toBe('accessibility_new');
    expect(component.getColumnHeaderIcon('Stance Time')).toBe('directions_walk');
    expect(component.getColumnHeaderIcon('Stance Time Balance Left')).toBe('directions_walk');
  });

  it('should provide icon mappings for requested device metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Average EVPE')).toBe('monitor_heart');
    expect(component.getColumnHeaderIcon('Average EHPE')).toBe('monitor_heart');
    expect(component.getColumnHeaderIcon('Average Satellite 5 Best SNR')).toBe('satellite_alt');
    expect(component.getColumnHeaderIcon('Average Number of Satellites')).toBe('satellite_alt');
    expect(component.getColumnHeaderIcon('Battery Charge')).toBe('battery_full');
    expect(component.getColumnHeaderIcon('Battery Consumption')).toBe('battery_alert');
    expect(component.getColumnHeaderIcon('Battery Current')).toBe('electric_bolt');
  });
});
