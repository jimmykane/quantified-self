import { DataDuration, DataPowerAvg, DataRPE } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { buildSummaryMetricTabs } from './summary-metric-tabs.helper';

describe('buildSummaryMetricTabs', () => {
  it('should return tabs in configured group order', () => {
    const tabs = buildSummaryMetricTabs([
      DataPowerAvg.type,
      DataRPE.type,
      DataDuration.type,
    ]);

    expect(tabs.map((tab) => tab.id)).toEqual(['general', 'power', 'physiological']);
    expect(tabs[0].metricTypes).toEqual([DataDuration.type]);
    expect(tabs[1].metricTypes).toEqual([DataPowerAvg.type]);
    expect(tabs[2].metricTypes).toEqual([DataRPE.type]);
  });

  it('should remove empty groups', () => {
    const tabs = buildSummaryMetricTabs([DataPowerAvg.type]);
    expect(tabs.map((tab) => tab.id)).toEqual(['power']);
  });

  it('should send unknown metric types to Other', () => {
    const tabs = buildSummaryMetricTabs(['Custom Stat']);
    expect(tabs.map((tab) => tab.id)).toEqual(['other']);
    expect(tabs[0].metricTypes).toEqual(['Custom Stat']);
  });
});
