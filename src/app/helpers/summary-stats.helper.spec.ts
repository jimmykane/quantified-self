import {
  ActivityTypes,
  DataStore,
  DataAscent,
  DataCadenceMin,
  DataDescent,
  DataFeeling,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedSpeedAvg,
  DataHeartRateMin,
  DataJumpCount,
  DataJumpDistanceAvg,
  DataJumpHeightAvg,
  DataJumpRotationsMin,
  DataJumpScoreAvg,
  DataJumpSpeedMax,
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
    expect(stats).toContain('Power Normalized');
    expect(stats).toContain('Power Training Stress Score');
    expect(stats).toContain('Ascent Time');
    expect(stats).toContain('Descent Time');
    expect(stats).toContain('Average Absolute Pressure');
    expect(stats).toContain('Average Grade');
    expect(stats).toContain('Average Ground Contact Time');
    expect(stats).toContain('Average Leg Stiffness');
    expect(stats).toContain('Average EVPE');
    expect(stats).toContain('Average EHPE');
    expect(stats).toContain(DataJumpCount.type);
    expect(stats).toContain(DataJumpDistanceAvg.type);
    expect(stats).toContain(DataJumpHeightAvg.type);
    expect(stats).toContain(DataJumpSpeedMax.type);
    expect(stats).toContain(DataJumpRotationsMin.type);
    expect(stats).toContain(DataJumpScoreAvg.type);
    expect(stats).toContain(DataStore.DataAvgVAM.type);
    expect(stats).toContain(DataStore.DataAvgRespirationRate.type);
    expect(stats).toContain(DataStore.DataMinRespirationRate.type);
    expect(stats).toContain(DataStore.DataMaxRespirationRate.type);
    expect(stats).toContain(DataStore.DataFitnessAge.type);
    expect(stats).toContain(DataStore.DataAnaerobicTrainingEffect.type);
    expect(stats).toContain(DataStore.DataGender.type);
    expect(stats).toContain(DataStore.DataHeight.type);
    expect(stats).toContain(DataStore.DataWeight.type);
  });

  it('should keep speed derivation behavior by activity type', () => {
    const runningStats = getDefaultSummaryStatTypes([ActivityTypes.Running]);
    const cyclingStats = getDefaultSummaryStatTypes([ActivityTypes.Cycling]);

    expect(runningStats).toContain(DataPaceAvg.type);
    expect(runningStats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(runningStats).toContain('Minimum Grade Adjusted Pace');
    expect(runningStats).toContain('Maximum Grade Adjusted Pace');
    expect(runningStats).not.toContain(DataGradeAdjustedSpeedAvg.type);
    expect(runningStats).not.toContain('Minimum Grade Adjusted Speed');
    expect(runningStats).not.toContain(DataSpeedAvg.type);
    expect(cyclingStats).toContain(DataSpeedAvg.type);
    expect(cyclingStats).toContain(DataGradeAdjustedSpeedAvg.type);
    expect(cyclingStats).toContain('Minimum Grade Adjusted Speed');
    expect(cyclingStats).toContain('Maximum Grade Adjusted Speed');
    expect(cyclingStats).not.toContain(DataGradeAdjustedPaceAvg.type);
    expect(cyclingStats).not.toContain('Minimum Grade Adjusted Pace');
  });

  it('should include both grade-adjusted families for mixed speed/pace activities', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.TrailRunning]);

    expect(stats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(stats).toContain(DataGradeAdjustedSpeedAvg.type);
    expect(stats).toContain('Minimum Grade Adjusted Pace');
    expect(stats).toContain('Maximum Grade Adjusted Pace');
    expect(stats).toContain('Minimum Grade Adjusted Speed');
    expect(stats).toContain('Maximum Grade Adjusted Speed');
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
