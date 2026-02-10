import {
  ActivityTypes,
  DataAscent,
  DataCadenceMin,
  DataDescent,
  DataFeeling,
  DataGradeAdjustedPaceAvg,
  DataHeartRateMin,
  DataPaceAvg,
  DataPowerMax,
  DataRPE,
  DataSpeedAvg,
  DataTemperatureMax,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { getDefaultSummaryStatTypes } from './summary-stats.helper';

describe('getDefaultSummaryStatTypes', () => {
  it('should include expanded default metrics from constants', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.Cycling]);

    expect(stats).toContain(DataPowerMax.type);
    expect(stats).toContain(DataCadenceMin.type);
    expect(stats).toContain(DataTemperatureMax.type);
    expect(stats).toContain(DataHeartRateMin.type);
    expect(stats).toContain(DataFeeling.type);
    expect(stats).toContain(DataRPE.type);
  });

  it('should keep speed derivation behavior by activity type', () => {
    const runningStats = getDefaultSummaryStatTypes([ActivityTypes.Running]);
    const cyclingStats = getDefaultSummaryStatTypes([ActivityTypes.Cycling]);

    expect(runningStats).toContain(DataPaceAvg.type);
    expect(runningStats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(runningStats).not.toContain(DataSpeedAvg.type);
    expect(cyclingStats).toContain(DataSpeedAvg.type);
  });

  it('should still exclude ascent and descent when manually configured', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.Cycling], {
      removeAscentForEventTypes: [ActivityTypes.Cycling],
      removeDescentForEventTypes: [ActivityTypes.Cycling],
    });

    expect(stats).not.toContain(DataAscent.type);
    expect(stats).not.toContain(DataDescent.type);
  });
});
