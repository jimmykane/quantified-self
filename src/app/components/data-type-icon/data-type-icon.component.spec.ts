import {
  DataAscent,
  DataAltitudeAvg,
  DataAltitudeMax,
  DataAltitudeMin,
  DataCadenceMax,
  DataCadenceMin,
  DataDescent,
  DataEnergy,
  DataFeeling,
  DataGradeAdjustedPaceAvg,
  DataPaceAvg,
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
  DataVerticalSpeedAvg,
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
    expect(component.getColumnHeaderIcon(DataCadenceMax.type)).toBe('cadence');
    expect(component.getColumnHeaderIcon(DataCadenceMin.type)).toBe('cadence');
    expect(component.getColumnHeaderIcon(DataTemperatureMax.type)).toBe('device_thermostat');
    expect(component.getColumnHeaderIcon(DataTemperatureMin.type)).toBe('device_thermostat');
    expect(component.getColumnHeaderIcon(DataAltitudeMax.type)).toBe('landscape');
    expect(component.getColumnHeaderIcon(DataAltitudeMin.type)).toBe('landscape');
    expect(component.getColumnHeaderIcon(DataAltitudeAvg.type)).toBe('landscape');
    expect(component.getColumnHeaderIcon(DataVerticalSpeedAvg.type)).toBe('unfold_more_double');
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
    expect(component.getColumnHeaderIcon('Average Grade')).toBe('tools_level');
    expect(component.getColumnHeaderIcon('Minimum Grade')).toBe('tools_level');
    expect(component.getColumnHeaderIcon('Maximum Grade')).toBe('tools_level');
  });

  it('should provide icon mappings for requested performance run-dynamics metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Average Ground Contact Time')).toBe('step_over');
    expect(component.getColumnHeaderIcon('Minimum Ground Contact Time')).toBe('step_over');
    expect(component.getColumnHeaderIcon('Maximum Ground Contact Time')).toBe('step_over');
    expect(component.getColumnHeaderIcon(DataVerticalOscillation.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon(DataVerticalOscillationAvg.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon(DataVerticalOscillationMin.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon(DataVerticalOscillationMax.type)).toBe('swap_vert');
    expect(component.getColumnHeaderIcon('Vertical Oscillation')).toBe('swap_vert');
    expect(component.getColumnHeaderIcon('Average Vertical Ratio')).toBe('arrows_outward');
    expect(component.getColumnHeaderIcon('Average Leg Stiffness')).toBe('accessibility_new');
    expect(component.getColumnHeaderIcon('Stance Time')).toBe('step_over');
    expect(component.getColumnHeaderIcon('Stance Time Balance Left')).toBe('step_over');
  });

  it('should provide icon mappings for grit and flow metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Flow')).toBe('water');
    expect(component.getColumnHeaderIcon('Average Flow')).toBe('automation');
    expect(component.getColumnHeaderIcon('Avg Flow')).toBe('water');
    expect(component.getColumnHeaderIcon('Total Flow')).toBe('water');
    expect(component.getColumnHeaderIcon('Grit')).toBe('cheer');
    expect(component.getColumnHeaderIcon('Avg Grit')).toBe('cheer');
    expect(component.getColumnHeaderIcon('Total Grit')).toBe('cheer');
  });

  it('should provide icon mappings for FTP', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('FTP')).toBe('recent_patient');
    expect(component.getColumnHeaderIcon('CriticalPower')).toBe('offline_bolt');
    expect(component.getColumnHeaderIcon('Power Normalized')).toBe('electric_bolt');
  });

  it('should provide icon mapping for Jump Count', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataJumpCount.type)).toBe('123');
  });

  it('should provide icon mappings for jump stat families', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataJumpDistance.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpDistanceAvg.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpDistanceMin.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpDistanceMax.type)).toBe('straighten');
    expect(component.getColumnHeaderIcon(DataJumpHangTimeAvg.type)).toBe('timer_arrow_up');
    expect(component.getColumnHeaderIcon(DataJumpHangTimeMin.type)).toBe('timer_arrow_up');
    expect(component.getColumnHeaderIcon(DataJumpHangTimeMax.type)).toBe('timer_arrow_up');
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

  it('should provide icon mappings for GNSS and Stryd distance', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('GNSS Distance')).toBe('satellite_alt');
    expect(component.getColumnHeaderIcon('Distance (Stryd)')).toBe('route');
  });

  it('should provide icon mappings for pace and grade adjusted pace metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon(DataPaceAvg.type)).toBe('steps');
    expect(component.getColumnHeaderIcon('Effort Pace')).toBe('steps');
    expect(component.getColumnHeaderIcon(DataGradeAdjustedPaceAvg.type)).toBe('steps');
    expect(component.getColumnHeaderIcon('Minimum Grade Adjusted Pace')).toBe('steps');
    expect(component.getColumnHeaderIcon('Maximum Grade Adjusted Pace')).toBe('steps');
  });

  it('should provide icon mappings for respiration rate metrics', () => {
    const component = new DataTypeIconComponent();

    expect(component.getColumnHeaderIcon('Avg Respiration Rate')).toBe('pulmonology');
    expect(component.getColumnHeaderIcon('Min Respiration Rate')).toBe('pulmonology');
    expect(component.getColumnHeaderIcon('Max Respiration Rate')).toBe('pulmonology');
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

    expect(component.getColumnHeaderIcon(DataEnergy.type)).toBe('metabolism');
    expect(component.getColumnHeaderIcon('Weight')).toBe('monitor_weight');
    expect(component.getColumnHeaderIcon('Height')).toBe('height');
    expect(component.getColumnHeaderIcon('Gender')).toBe('wc');
    expect(component.getColumnHeaderIcon('Fitness Age')).toBe('cake');
    expect(component.getColumnHeaderIcon('Age')).toBe('cake');
  });
});
