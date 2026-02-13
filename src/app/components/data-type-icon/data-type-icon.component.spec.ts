import {
  DataAscent,
  DataAltitudeAvg,
  DataCadenceMax,
  DataCadenceMin,
  DataDescent,
  DataFeeling,
  DataPowerMax,
  DataPowerMin,
  DataJumpCount,
  DataJumpDistance,
  DataJumpDistanceAvg,
  DataJumpDistanceMax,
  DataJumpDistanceMin,
  DataJumpHangTimeAvg,
  DataJumpHangTimeMax,
  DataJumpHangTimeMin,
  DataJumpHeightAvg,
  DataJumpHeightMax,
  DataJumpHeightMin,
  DataJumpRotationsAvg,
  DataJumpRotationsMax,
  DataJumpRotationsMin,
  DataJumpScoreAvg,
  DataJumpScoreMax,
  DataJumpScoreMin,
  DataJumpSpeedAvg,
  DataJumpSpeedAvgFeetPerMinute,
  DataJumpSpeedAvgFeetPerSecond,
  DataJumpSpeedAvgKilometersPerHour,
  DataJumpSpeedAvgKnots,
  DataJumpSpeedAvgMetersPerMinute,
  DataJumpSpeedAvgMilesPerHour,
  DataJumpSpeedMax,
  DataJumpSpeedMaxFeetPerMinute,
  DataJumpSpeedMaxFeetPerSecond,
  DataJumpSpeedMaxKilometersPerHour,
  DataJumpSpeedMaxKnots,
  DataJumpSpeedMaxMetersPerMinute,
  DataJumpSpeedMaxMilesPerHour,
  DataJumpSpeedMin,
  DataJumpSpeedMinFeetPerMinute,
  DataJumpSpeedMinFeetPerSecond,
  DataJumpSpeedMinKilometersPerHour,
  DataJumpSpeedMinKnots,
  DataJumpSpeedMinMetersPerMinute,
  DataJumpSpeedMinMilesPerHour,
  DataRPE,
  DataTemperatureMax,
  DataTemperatureMin,
  DataVerticalOscillation,
  DataVerticalOscillationAvg,
  DataVerticalOscillationMax,
  DataVerticalOscillationMin
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
    expect(component.getColumnHeaderIcon(DataVerticalOscillation.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon(DataVerticalOscillationAvg.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon(DataVerticalOscillationMin.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon(DataVerticalOscillationMax.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon('Vertical Oscillation')).toBe('swap_vert');
    expect(component.getColumnHeaderIcon('Average Vertical Ratio')).toBe('show_chart');
    expect(component.getColumnHeaderIcon('Average Leg Stiffness')).toBe('accessibility_new');
    expect(component.getColumnHeaderIcon('Stance Time')).toBe('directions_walk');
    expect(component.getColumnHeaderIcon('Stance Time Balance Left')).toBe('directions_walk');
  });

  it('should provide icon mappings for grit and flow metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Flow')).toBe('water');
    expect(component.getColumnHeaderIcon('Avg Flow')).toBe('water');
    expect(component.getColumnHeaderIcon('Total Flow')).toBe('water');
    expect(component.getColumnHeaderIcon('Grit')).toBe('terrain');
    expect(component.getColumnHeaderIcon('Avg Grit')).toBe('terrain');
    expect(component.getColumnHeaderIcon('Total Grit')).toBe('terrain');
  });

  it('should provide icon mappings for FTP', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('FTP')).toBe('bolt');
  });

  it('should provide icon mapping for Jump Count', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataJumpCount.type)).toBe('format_list_numbered');
  });

  it('should provide icon mappings for jump stat families', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataJumpDistance.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpDistanceAvg.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpDistanceMin.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpDistanceMax.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpHangTimeAvg.type)).toBe('schedule');
    expect(component.getColumnHeaderIcon(DataJumpHangTimeMin.type)).toBe('schedule');
    expect(component.getColumnHeaderIcon(DataJumpHangTimeMax.type)).toBe('schedule');
    expect(component.getColumnHeaderIcon(DataJumpHeightAvg.type)).toBe('height');
    expect(component.getColumnHeaderIcon(DataJumpHeightMin.type)).toBe('height');
    expect(component.getColumnHeaderIcon(DataJumpHeightMax.type)).toBe('height');
    expect(component.getColumnHeaderIcon(DataJumpSpeedAvg.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMin.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMax.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedAvgKilometersPerHour.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedAvgMilesPerHour.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedAvgFeetPerSecond.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedAvgMetersPerMinute.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedAvgFeetPerMinute.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedAvgKnots.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMinKilometersPerHour.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMinMilesPerHour.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMinFeetPerSecond.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMinMetersPerMinute.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMinFeetPerMinute.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMinKnots.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMaxKilometersPerHour.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMaxMilesPerHour.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMaxFeetPerSecond.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMaxMetersPerMinute.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMaxFeetPerMinute.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpSpeedMaxKnots.type)).toBe('speed');
    expect(component.getColumnHeaderIcon(DataJumpRotationsAvg.type)).toBe('autorenew');
    expect(component.getColumnHeaderIcon(DataJumpRotationsMin.type)).toBe('autorenew');
    expect(component.getColumnHeaderIcon(DataJumpRotationsMax.type)).toBe('autorenew');
    expect(component.getColumnHeaderIcon(DataJumpScoreAvg.type)).toBe('military_tech');
    expect(component.getColumnHeaderIcon(DataJumpScoreMin.type)).toBe('military_tech');
    expect(component.getColumnHeaderIcon(DataJumpScoreMax.type)).toBe('military_tech');
  });

  it('should provide icon mapping for Avg VAM', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Avg VAM')).toBe('trending_up');
  });

  it('should provide icon mappings for respiration rate metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Avg Respiration Rate')).toBe('respiratory_rate');
    expect(component.getColumnHeaderIcon('Min Respiration Rate')).toBe('respiratory_rate');
    expect(component.getColumnHeaderIcon('Max Respiration Rate')).toBe('respiratory_rate');
  });

  it('should provide icon mapping for anaerobic training effect', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Anaerobic Training Effect')).toBe('cardio_load');
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

  it('should provide icon mappings for physiological profile metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Weight')).toBe('monitor_weight');
    expect(component.getColumnHeaderIcon('Height')).toBe('height');
    expect(component.getColumnHeaderIcon('Gender')).toBe('wc');
    expect(component.getColumnHeaderIcon('Fitness Age')).toBe('cake');
    expect(component.getColumnHeaderIcon('Age')).toBe('cake');
  });
});
