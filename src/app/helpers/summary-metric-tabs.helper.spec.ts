import {
  DataAbsolutePressure,
  DataAirPower,
  DataStore,
  DataEnergy,
  DataDuration,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedSpeedAvg,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataHeartRateMin,
  DataPaceAvg,
  DataPowerAvg,
  DataRecoveryTime,
  DataRPE,
  DataSpeedAvg,
  DataSwimPaceAvg,
  DataVerticalSpeedAvg,
  DataVO2Max,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { buildSummaryMetricTabs } from './summary-metric-tabs.helper';

describe('buildSummaryMetricTabs', () => {
  it('should return tabs in configured group order', () => {
    const tabs = buildSummaryMetricTabs([
      DataPowerAvg.type,
      DataRPE.type,
      DataDuration.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['overall', 'performance', 'physiological']);
    expect(tabs[0].metricTypes).toEqual([DataDuration.type, DataPowerAvg.type]);
    expect(tabs[1].metricTypes).toEqual([DataPowerAvg.type]);
    expect(tabs[2].metricTypes).toEqual([DataRPE.type]);
  });

  it('should remove empty groups', () => {
    const tabs = buildSummaryMetricTabs([DataPowerAvg.type]);
    expect(tabs.map((tab) => tab.id)).toEqual(['overall', 'performance']);
  });

  it('should send unknown metric types to Other', () => {
    const tabs = buildSummaryMetricTabs(['Custom Stat']);
    expect(tabs.map((tab) => tab.id)).toEqual(['other']);
    expect(tabs[0].metricTypes).toEqual(['Custom Stat']);
  });

  it('should keep overall metrics in configured order', () => {
    const tabs = buildSummaryMetricTabs([
      DataPowerAvg.type,
      DataDuration.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['overall', 'performance']);
    expect(tabs[0].metricTypes).toEqual([DataDuration.type, DataPowerAvg.type]);
    expect(tabs[1].metricTypes).toEqual([DataPowerAvg.type]);
  });

  it('should keep performance tab speed metric order and configured vertical speed single-value override', () => {
    const tabs = buildSummaryMetricTabs([
      DataVerticalSpeedAvg.type,
      DataGradeAdjustedSpeedAvg.type,
      DataGradeAdjustedPaceAvg.type,
      DataPaceAvg.type,
      DataSpeedAvg.type,
      DataSwimPaceAvg.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['overall', 'performance']);
    const performanceTab = tabs.find((tab) => tab.id === 'performance');
    expect(performanceTab?.metricTypes).toEqual([
      DataSpeedAvg.type,
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
      DataGradeAdjustedPaceAvg.type,
      DataGradeAdjustedSpeedAvg.type,
      DataVerticalSpeedAvg.type,
    ]);
    expect(performanceTab?.singleValueTypes).toEqual([DataVerticalSpeedAvg.type]);
  });

  it('should map extended power types and keep removed speed/power zone durations in Other', () => {
    const tabs = buildSummaryMetricTabs([
      'Power Normalized',
      'CriticalPower',
      'Power Training Stress Score',
      'Power Zone Four Duration',
      'Speed Zone Two Duration',
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['performance', 'other']);

    const performanceTab = tabs.find((tab) => tab.id === 'performance');
    expect(performanceTab?.metricTypes).toEqual([
      'Power Normalized',
      'Power Training Stress Score',
      'CriticalPower',
    ]);

    const otherTab = tabs.find((tab) => tab.id === 'other');
    expect(otherTab?.metricTypes).toEqual([
      'Power Zone Four Duration',
      'Speed Zone Two Duration',
    ]);
  });

  it('should map ascent and descent time into environment tab', () => {
    const tabs = buildSummaryMetricTabs([
      'Ascent Time',
      'Descent Time',
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['environment']);
    expect(tabs[0].metricTypes).toEqual([
      'Ascent Time',
      'Descent Time',
    ]);
  });

  it('should copy recovery/vo2 to overall and calories to physiological', () => {
    const tabs = buildSummaryMetricTabs([
      DataRecoveryTime.type,
      DataVO2Max.type,
      DataEnergy.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['overall', 'physiological']);
    expect(tabs[0].metricTypes).toEqual([
      DataRecoveryTime.type,
      DataVO2Max.type,
    ]);
    expect(tabs[1].metricTypes).toEqual([
      DataEnergy.type,
      DataVO2Max.type,
      DataRecoveryTime.type,
    ]);
  });

  it('should map requested extras into physiological, environment, and performance tabs', () => {
    const tabs = buildSummaryMetricTabs([
      DataStore.DataAge.type,
      DataStore.DataGender.type,
      DataStore.DataHeight.type,
      DataStore.DataWeight.type,
      DataStore.DataFitnessAge.type,
      DataAbsolutePressure.type,
      DataAirPower.type,
      DataStore.DataEffortPace.type,
      DataStore.DataAvgVAM.type,
      DataStore.DataFormPower.type,
      DataStore.DataEPOC.type,
      DataStore.DataJumpCount.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual([
      'performance',
      'environment',
      'physiological',
    ]);

    const performanceTab = tabs.find((tab) => tab.id === 'performance');
    expect(performanceTab?.metricTypes).toEqual([
      DataAirPower.type,
      DataStore.DataEffortPace.type,
      DataStore.DataAvgVAM.type,
      DataStore.DataEPOC.type,
      DataStore.DataJumpCount.type,
      DataStore.DataFormPower.type,
    ]);

    const environmentTab = tabs.find((tab) => tab.id === 'environment');
    expect(environmentTab?.metricTypes).toEqual([DataAbsolutePressure.type]);

    const physiologicalTab = tabs.find((tab) => tab.id === 'physiological');
    expect(physiologicalTab?.metricTypes).toEqual([
      DataStore.DataWeight.type,
      DataStore.DataHeight.type,
      DataStore.DataGender.type,
      DataStore.DataFitnessAge.type,
      DataStore.DataAge.type,
    ]);
  });

  it('should map device metrics into the new device tab', () => {
    const tabs = buildSummaryMetricTabs([
      'Battery Charge',
      'Battery Consumption',
      'Battery Current',
      'Battery Voltage',
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['device']);
    expect(tabs[0].metricTypes).toEqual([
      'Battery Charge',
      'Battery Consumption',
      'Battery Current',
      'Battery Voltage',
    ]);
  });

  it('should map new environment grade and pressure families', () => {
    const tabs = buildSummaryMetricTabs([
      'Absolute Pressure',
      'Average Absolute Pressure',
      'Minimum Absolute Pressure',
      'Maximum Absolute Pressure',
      'Grade',
      'Average Grade',
      'Minimum Grade',
      'Maximum Grade',
      'Distance (Stryd)',
      'GNSS Distance',
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['environment']);

    const environmentTab = tabs.find((tab) => tab.id === 'environment');
    expect(environmentTab?.metricTypes).toEqual([
      'Absolute Pressure',
      'Average Absolute Pressure',
      'Minimum Absolute Pressure',
      'Maximum Absolute Pressure',
      'Grade',
      'Average Grade',
      'Minimum Grade',
      'Maximum Grade',
      'Distance (Stryd)',
      'GNSS Distance',
    ]);

  });

  it('should map requested performance run-dynamics metrics', () => {
    const tabs = buildSummaryMetricTabs([
      'Form Power',
      'Average Ground Contact Time',
      'Minimum Ground Contact Time',
      'Maximum Ground Contact Time',
      'Stance Time',
      'Stance Time Balance Left',
      'Vertical Oscillation',
      'Vertical Ratio',
      'Average Vertical Ratio',
      'Minimum Vertical Ratio',
      'Maximum Vertical Ratio',
      'Leg Stiffness',
      'Average Leg Stiffness',
      'Minimum Leg Stiffness',
      'Maximum Leg Stiffness',
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['performance']);
    expect(tabs[0].metricTypes).toEqual([
      'Average Ground Contact Time',
      'Minimum Ground Contact Time',
      'Maximum Ground Contact Time',
      'Stance Time',
      'Stance Time Balance Left',
      'Vertical Oscillation',
      'Vertical Ratio',
      'Average Vertical Ratio',
      'Minimum Vertical Ratio',
      'Maximum Vertical Ratio',
      'Leg Stiffness',
      'Average Leg Stiffness',
      'Minimum Leg Stiffness',
      'Maximum Leg Stiffness',
      'Form Power',
    ]);
  });

  it('should map EVPE, EHPE and satellite families to device tab', () => {
    const tabs = buildSummaryMetricTabs([
      'EVPE',
      'Average EVPE',
      'Minimum EVPE',
      'Maximum EVPE',
      'EHPE',
      'Average EHPE',
      'Minimum EHPE',
      'Maximum EHPE',
      'Satellite 5 Best SNR',
      'Average Satellite 5 Best SNR',
      'Minimum Satellite 5 Best SNR',
      'Maximum Satellite 5 Best SNR',
      'Number of Satellites',
      'Average Number of Satellites',
      'Minimum Number of Satellites',
      'Maximum Number of Satellites',
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['device']);
    expect(tabs[0].metricTypes).toEqual([
      'EVPE',
      'Average EVPE',
      'Minimum EVPE',
      'Maximum EVPE',
      'EHPE',
      'Average EHPE',
      'Minimum EHPE',
      'Maximum EHPE',
      'Satellite 5 Best SNR',
      'Average Satellite 5 Best SNR',
      'Minimum Satellite 5 Best SNR',
      'Maximum Satellite 5 Best SNR',
      'Number of Satellites',
      'Average Number of Satellites',
      'Minimum Number of Satellites',
      'Maximum Number of Satellites',
    ]);
  });

  it('should keep physiological metrics and also expose heart rate in performance', () => {
    const tabs = buildSummaryMetricTabs([
      DataHeartRateAvg.type,
      DataHeartRateMax.type,
      DataHeartRateMin.type,
      DataEnergy.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['overall', 'performance', 'physiological']);

    const performanceTab = tabs.find((tab) => tab.id === 'performance');
    expect(performanceTab?.metricTypes).toEqual([
      DataHeartRateAvg.type,
      DataHeartRateMax.type,
      DataHeartRateMin.type,
    ]);

    const physiologicalTab = tabs.find((tab) => tab.id === 'physiological');
    expect(physiologicalTab?.metricTypes).toEqual([
      DataEnergy.type,
    ]);
  });

  it('should map aerobic and anaerobic training effect to physiological', () => {
    const tabs = buildSummaryMetricTabs([
      'Aerobic Training Effect',
      'Anaerobic Training Effect',
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['physiological']);
    expect(tabs[0].metricTypes).toEqual([
      'Aerobic Training Effect',
      'Anaerobic Training Effect',
    ]);
  });

  it('should map respiration rate family to physiological tab', () => {
    const tabs = buildSummaryMetricTabs([
      DataStore.DataAvgRespirationRate.type,
      DataStore.DataMinRespirationRate.type,
      DataStore.DataMaxRespirationRate.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['physiological']);
    expect(tabs[0].metricTypes).toEqual([
      DataStore.DataAvgRespirationRate.type,
      DataStore.DataMinRespirationRate.type,
      DataStore.DataMaxRespirationRate.type,
    ]);
  });
});
