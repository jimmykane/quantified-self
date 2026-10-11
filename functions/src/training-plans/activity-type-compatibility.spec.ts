import { ActivityTypes } from '@sports-alliance/sports-lib';
import { RefinedTrainingActivityTypes, resolveCompatibleActivityType } from '../../../shared/activity-type-compatibility';

describe('approved canonical sport compatibility', () => {
  it.each(Object.values(RefinedTrainingActivityTypes))('preserves %s and its trimmed case-insensitive form', sport => {
    expect(resolveCompatibleActivityType(sport)).toBe(sport);
    expect(resolveCompatibleActivityType(` ${sport.toLowerCase()} `)).toBe(sport);
  });

  it('preserves installed canonical names and rejects unrelated unknown names', () => {
    expect(resolveCompatibleActivityType(ActivityTypes.Cycling)).toBe(ActivityTypes.Cycling);
    expect(resolveCompatibleActivityType(ActivityTypes.Running)).toBe(ActivityTypes.Running);
    expect(resolveCompatibleActivityType('invented sport')).toBeNull();
    expect(resolveCompatibleActivityType(null)).toBeNull();
  });
});
