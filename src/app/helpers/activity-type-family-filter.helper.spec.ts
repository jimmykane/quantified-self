import { describe, expect, it } from 'vitest';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { getCanonicalActivityTypesForFilterFamily, isRunningFamilyActivityType } from '@shared/activity-type-family';
import { getActivityTypeFamilyFilterOptions, toggleActivityTypeFamilySelection } from './activity-type-family-filter.helper';

describe('activity type family filter shortcuts', () => {
  it('offers only installed canonical types and preserves distinct individual names', () => {
    const catalog = ActivityTypesHelper.getActivityTypesAsUniqueArray();
    const families = getActivityTypeFamilyFilterOptions([]);
    expect(families.map(family => family.id)).toEqual(['running', 'cycling', 'walking-hiking']);
    expect(families.map(family => family.label)).toEqual(['All Running / Trail', 'All Cycling / MTB', 'All Walking / Hiking']);
    families.flatMap(family => family.activityTypes).forEach(type => expect(catalog).toContain(type));
    expect(getCanonicalActivityTypesForFilterFamily('walking-hiking')).toEqual(expect.arrayContaining([
      ActivityTypes.Walking, ActivityTypes.NordicWalking, ActivityTypes.Hiking, ActivityTypes.Trekking,
    ]));
    expect(getCanonicalActivityTypesForFilterFamily('walking-hiking')).not.toContain(ActivityTypes.HorsebackRiding);
  });

  it('marks an exact subset partial without expanding it during hydration', () => {
    const selected = [ActivityTypes.Running, ActivityTypes.Yoga];
    const option = getActivityTypeFamilyFilterOptions(selected).find(family => family.id === 'running')!;
    expect(option.selected).toBe(false);
    expect(option.partial).toBe(true);
    expect(selected).toEqual([ActivityTypes.Running, ActivityTypes.Yoga]);
    const expanded = toggleActivityTypeFamilySelection(selected, option, true);
    expect(expanded).toEqual(expect.arrayContaining([...option.activityTypes, ActivityTypes.Yoga]));
    expect(getActivityTypeFamilyFilterOptions(expanded).find(family => family.id === 'running')?.selected).toBe(true);
    expect(toggleActivityTypeFamilySelection(expanded, option, false)).toEqual([ActivityTypes.Yoga]);
  });

  it('limits family actions to available context while preserving an outside selected filter', () => {
    const selected = [ActivityTypes.Running];
    const options = getActivityTypeFamilyFilterOptions(selected, [ActivityTypes.Cycling]);
    expect(options).toHaveLength(1);
    expect(options[0].activityTypes).toEqual([ActivityTypes.Cycling]);
    expect(toggleActivityTypeFamilySelection(selected, options[0], true)).toEqual([ActivityTypes.Running, ActivityTypes.Cycling]);
    expect(getActivityTypeFamilyFilterOptions(selected, [])).toEqual([]);
  });

  it('recognizes approved running export variants without widening authoring choices', () => {
    ['Running', 'Trail Running', 'Treadmill', 'Indoor Running', 'Virtual Running', 'Road Running', 'Indoor Track Running', 'Vertical Running']
      .forEach(type => expect(isRunningFamilyActivityType(type)).toBe(true));
    ['Cycling', 'Walking', 'Hiking', 'Track and Field', 'Unknown Sport', null]
      .forEach(type => expect(isRunningFamilyActivityType(type)).toBe(false));
  });
});
