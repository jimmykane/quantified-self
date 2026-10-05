import { describe, expect, it } from 'vitest';
import { ActivityTypes, DataDistance, DataDuration, DataSwimDistance, DistanceUnits } from '@sports-alliance/sports-lib';
import { analyzeWorkoutStructureV1, aggregateWorkoutAnalysesV1 } from '@shared/planned-workout-analysis';
import { formatWorkoutAnalysisSummaryV1, formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { normalizeUserUnitSettings, resolveUnitAwareDisplayFromValue, resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';

const recipe = { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: 'one', purpose: 'work',
  ending: { kind: 'distance', meters: 1609.344 }, targets: [{ kind: 'speed', mode: 'absolute', presentation: 'speed',
    minimumMetersPerSecond: 4, maximumMetersPerSecond: 4 }] }] };

describe('owner-unit workout analysis display', () => {
  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])('formats estimates and prescribed distance using Sports Lib %s', distanceUnits => {
    const units = normalizeUserUnitSettings({ distanceUnits });
    const analysis = analyzeWorkoutStructureV1(recipe);
    const distance = resolveUnitAwareDisplayFromValue(DataDistance.type, 1609.344, units)!.text;
    const duration = resolveUnitAwareDisplayFromValue(DataDuration.type, 1609.344 / 4, units)!.text;
    expect(formatWorkoutAnalysisSummaryV1(analysis.summary, units, recipe.sport)).toBe(`${duration} estimated · ${distance} prescribed`);
    expect(analysis.summary.distance.completeExactMeters).toBe(1609.344);
  });
  it('labels covered duration as partial and never displays missing distance as zero', () => {
    const input = { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'time', purpose: 'warmup', ending: { kind: 'time', seconds: 600 }, targets: [] },
      { kind: 'repeat', id: 'repeat', count: 4, steps: [{ kind: 'step', id: 'recover', purpose: 'recovery',
        ending: { kind: 'manual' }, targets: [] }] },
    ] };
    const time = resolveUnitAwareDisplayFromValue(DataDuration.type, 600)!.text;
    expect(formatWorkoutPrescriptionSummaryV1(input)).toBe(`${time} timed subtotal + 4 steps with unknown duration`);
    expect(formatWorkoutPrescriptionSummaryV1({ ...input, nodes: [input.nodes[1]] })).toBe('Duration unknown');
  });
  it('does not claim a complete total from an incomplete source scan', () => {
    const combined = aggregateWorkoutAnalysesV1([analyzeWorkoutStructureV1(recipe)], { sourceComplete: false });
    expect(formatWorkoutAnalysisSummaryV1(combined.summary)).toContain('estimated (partial source)');
    expect(formatWorkoutAnalysisSummaryV1(combined.summary)).toContain('distance subtotal');
  });
  it('labels numeric totals as prescribed limits when early Lap can shorten execution', () => {
    const input = { ...recipe, nodes: [{ ...recipe.nodes[0], ending: { kind: 'time', seconds: 60, allowEarlyLap: true } }] };
    const time = resolveUnitAwareDisplayFromValue(DataDuration.type, 60)!.text;
    expect(formatWorkoutPrescriptionSummaryV1(input)).toBe(`${time} (prescribed limits) · 1 step allows early Lap`);
    expect(formatWorkoutPrescriptionSummaryV1({ ...input, nodes: [{ kind: 'repeat', id: 'repeat', count: 3, steps: input.nodes }] }))
      .toContain('3 steps allow early Lap');
    expect(formatWorkoutPrescriptionSummaryV1({ ...input, nodes: [{ ...input.nodes[0], ending: { kind: 'time', seconds: 60, allowEarlyLap: false } }] }))
      .toBe(time);
  });
  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])('uses swimming and rowing sport-specific distance display with %s', distanceUnits => {
    const units = normalizeUserUnitSettings({ distanceUnits });
    const swimming = { ...recipe, sport: ActivityTypes.Swimming };
    const swimDistance = resolveUnitAwareDisplayStat(new DataSwimDistance(1609.344), units)!.text;
    expect(formatWorkoutPrescriptionSummaryV1(swimming, units, swimming.sport)).toContain(`${swimDistance} prescribed`);
    const rowing = { ...recipe, sport: ActivityTypes.Rowing };
    const rowDistance = resolveUnitAwareDisplayFromValue(DataDistance.type, 1609.344,
      { ...units, distanceUnits: DistanceUnits.Kilometers })!.text;
    expect(formatWorkoutPrescriptionSummaryV1(rowing, units, rowing.sport)).toContain(`${rowDistance} prescribed`);
  });
  it('shows unavailable totals for overflow without fabricating a number', () => {
    expect(formatWorkoutPrescriptionSummaryV1({ ...recipe, nodes: [{ kind: 'repeat', id: 'repeat', count: 100,
      steps: [{ kind: 'step', id: 'huge', purpose: 'work', ending: { kind: 'time', seconds: Number.MAX_VALUE }, targets: [] }] }] }))
      .toBe('Prescription totals unavailable');
  });
});
