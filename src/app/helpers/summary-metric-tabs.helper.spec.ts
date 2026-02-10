import {
  DataEnergy,
  DataDuration,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedSpeedAvg,
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
});
