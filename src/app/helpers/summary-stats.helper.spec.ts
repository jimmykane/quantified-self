import {
  ActivityTypes,
  DataAltitudeAvg,
  DataAltitudeMax,
  DataAltitudeMin,
  DataAscentTime,
  DataAvgVAM,
  DataStore,
  DataAscent,
  DataCadenceMin,
  DataBeginningPotentialStamina,
  DataDescent,
  DataDescentTime,
  DataDepthAvg,
  DataEndingPotentialStamina,
  DataFeeling,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedPaceMax,
  DataGradeAdjustedPaceMin,
  DataGradeAdjustedSpeedAvg,
  DataGradeAdjustedSpeedMax,
  DataGradeAdjustedSpeedMin,
  DataGrade,
  DataGradeAvg,
  DataGradeMax,
  DataGradeMin,
  DataHeartRateMin,
  DataJumpCount,
  DataJumpDistanceAvg,
  DataJumpHeightAvg,
  DataJumpRotationsMin,
  DataJumpScoreAvg,
  DataJumpSpeedMax,
  DataMetabolicCalories,
  DataPaceAvg,
  DataPotentialStaminaAvg,
  DataPotentialStaminaMin,
  DataPowerMax,
  DataPowerTrainingStressScore,
  DataRPE,
  DataSpeedAvg,
  DataStaminaAvg,
  DataStaminaMin,
  DataStrokeRateMin,
  DataTemperatureMax,
  DataVerticalSpeedMax,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { getDefaultSummaryStatTypes } from './summary-stats.helper';

describe('getDefaultSummaryStatTypes', () => {
  it('should include expanded default metrics from constants', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.Cycling]);

    expect(stats).toContain(DataPowerMax.type);
    expect(stats).toContain(DataCadenceMin.type);
    expect(stats).toContain(DataStrokeRateMin.type);
    expect(stats).toContain(DataTemperatureMax.type);
    expect(stats).toContain(DataHeartRateMin.type);
    expect(stats).toContain(DataFeeling.type);
    expect(stats).toContain(DataRPE.type);
    expect(stats).toContain('Power Normalized');
    expect(stats).toContain(DataPowerTrainingStressScore.type);
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
    expect(stats).toContain(DataDepthAvg.type);
    expect(stats).toContain(DataMetabolicCalories.type);
    expect(stats).toContain(DataStore.DataAvgVAM.type);
    expect(stats).toContain(DataStore.DataAvgRespirationRate.type);
    expect(stats).toContain(DataStore.DataMinRespirationRate.type);
    expect(stats).toContain(DataStore.DataMaxRespirationRate.type);
    expect(stats).toContain(DataStore.DataFitnessAge.type);
    expect(stats).toContain(DataStore.DataAnaerobicTrainingEffect.type);
    expect(stats).toContain(DataStore.DataGender.type);
    expect(stats).toContain(DataStore.DataHeight.type);
    expect(stats).toContain(DataStore.DataWeight.type);
    expect(stats).toContain(DataStaminaAvg.type);
    expect(stats).toContain(DataStaminaMin.type);
    expect(stats).toContain(DataPotentialStaminaAvg.type);
    expect(stats).toContain(DataPotentialStaminaMin.type);
    expect(stats).toContain(DataBeginningPotentialStamina.type);
    expect(stats).toContain(DataEndingPotentialStamina.type);
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

  it('should prefer pace-derived families over speed when activity exposes both', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.TrailRunning]);

    expect(stats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(stats).toContain('Minimum Grade Adjusted Pace');
    expect(stats).toContain('Maximum Grade Adjusted Pace');
    expect(stats).not.toContain(DataSpeedAvg.type);
    expect(stats).not.toContain(DataGradeAdjustedSpeedAvg.type);
    expect(stats).not.toContain('Minimum Grade Adjusted Speed');
    expect(stats).not.toContain('Maximum Grade Adjusted Speed');
  });

  it('should normalize raw running aliases to running pace families', () => {
    const stats = getDefaultSummaryStatTypes(['running' as unknown as ActivityTypes]);

    expect(stats).toContain(DataPaceAvg.type);
    expect(stats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(stats).toContain('Minimum Grade Adjusted Pace');
    expect(stats).toContain('Maximum Grade Adjusted Pace');
    expect(stats).not.toContain(DataSpeedAvg.type);
    expect(stats).not.toContain(DataGradeAdjustedSpeedAvg.type);
    expect(stats).not.toContain('Minimum Grade Adjusted Speed');
  });

  it('should normalize non-canonical running strings (case/whitespace) to pace families', () => {
    const stats = getDefaultSummaryStatTypes([' RUNNING ' as unknown as ActivityTypes]);

    expect(stats).toContain(DataPaceAvg.type);
    expect(stats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(stats).toContain('Minimum Grade Adjusted Pace');
    expect(stats).not.toContain(DataGradeAdjustedSpeedAvg.type);
    expect(stats).not.toContain('Minimum Grade Adjusted Speed');
  });

  it('should normalize raw trail aliases to mixed speed/pace families', () => {
    const stats = getDefaultSummaryStatTypes(['running_trail' as unknown as ActivityTypes]);

    expect(stats).toContain(DataPaceAvg.type);
    expect(stats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(stats).toContain('Minimum Grade Adjusted Pace');
    expect(stats).not.toContain(DataSpeedAvg.type);
    expect(stats).not.toContain(DataGradeAdjustedSpeedAvg.type);
    expect(stats).not.toContain('Minimum Grade Adjusted Speed');
  });

  it('should still exclude ascent and descent when manually configured', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.Cycling], {
      removeAscentForEventTypes: [ActivityTypes.Cycling],
      removeDescentForEventTypes: [ActivityTypes.Cycling],
    });

    expect(stats).not.toContain(DataAscent.type);
    expect(stats).not.toContain(DataDescent.type);
  });

  it('should exclude ascent and descent for non-canonical configured activity types', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.Cycling], {
      removeAscentForEventTypes: [' cycling '],
      removeDescentForEventTypes: ['CYCLING'],
    });

    expect(stats).not.toContain(DataAscent.type);
    expect(stats).not.toContain(DataDescent.type);
  });

  it('should automatically exclude terrain-derived metrics for every Diving-group activity', () => {
    [
      ActivityTypes.Diving,
      ActivityTypes.ScubaDiving,
      ActivityTypes.FreeDiving,
      ActivityTypes.Snorkeling,
      ActivityTypes.Mermaiding,
    ].forEach((activityType) => {
      const stats = getDefaultSummaryStatTypes([activityType]);

      expect(stats).not.toContain(DataAscent.type);
      expect(stats).not.toContain(DataDescent.type);
      expect(stats).not.toContain(DataAltitudeMax.type);
      expect(stats).not.toContain(DataAltitudeMin.type);
      expect(stats).not.toContain(DataAltitudeAvg.type);
      expect(stats).not.toContain(DataAscentTime.type);
      expect(stats).not.toContain(DataDescentTime.type);
      expect(stats).not.toContain(DataGrade.type);
      expect(stats).not.toContain(DataGradeAvg.type);
      expect(stats).not.toContain(DataGradeMin.type);
      expect(stats).not.toContain(DataGradeMax.type);
      expect(stats).not.toContain(DataGradeAdjustedPaceAvg.type);
      expect(stats).not.toContain(DataGradeAdjustedPaceMin.type);
      expect(stats).not.toContain(DataGradeAdjustedPaceMax.type);
      expect(stats).not.toContain(DataGradeAdjustedSpeedAvg.type);
      expect(stats).not.toContain(DataGradeAdjustedSpeedMin.type);
      expect(stats).not.toContain(DataGradeAdjustedSpeedMax.type);
      expect(stats).not.toContain(DataAvgVAM.type);
      expect(stats).not.toContain(DataVerticalSpeedMax.type);
    });
  });

  it('should retain terrain-derived metrics for mixed Diving and non-Diving selections', () => {
    const stats = getDefaultSummaryStatTypes([ActivityTypes.ScubaDiving, ActivityTypes.Running]);

    expect(stats).toContain(DataAltitudeAvg.type);
    expect(stats).toContain(DataAscentTime.type);
    expect(stats).toContain(DataGradeAvg.type);
    expect(stats).toContain(DataGradeAdjustedPaceAvg.type);
    expect(stats).toContain(DataVerticalSpeedMax.type);
  });
});
