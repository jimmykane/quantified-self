import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ActivityTypes, EventImporterJSON } from '@sports-alliance/sports-lib';
import { prepareActivitySourceBindings } from './activity-source-binding';

function event(types = [ActivityTypes.Yoga]) {
  const result = EventImporterJSON.getEventFromJSON({ name: 'Synthetic', startDate: 1000,
    endDate: 1000 + types.length * 60000, stats: {}, activities: types.map((type, index) => ({
      startDate: 1000 + index * 60000, endDate: 61000 + index * 60000, type,
      creator: { name: 'Synthetic', devices: [] }, stats: { Duration: 60, Distance: 0 },
      laps: [], streams: [], events: [], intensityZones: [], powerMeter: false, trainer: false,
    })) });
  result.getActivities().forEach((activity, i) => activity.setID(`incoming-${i}`));
  return result;
}

const saved = (id: string, type = 'Stretching', extra = {}) => ({ id, data: () => ({
  startDate: new Date(1000), endDate: new Date(61000), type, stats: { Duration: 60, Distance: 0 }, ...extra,
}) });

describe('stable activity source bindings', () => {
  it('adopts a legacy provider update only with verified scope and retained-source type evidence', () => {
    const parsed = event();
    expect(() => prepareActivitySourceBindings(parsed, [saved('stable')])).toThrow();
    expect(() => prepareActivitySourceBindings(parsed, [saved('stable')], { allowSourceWindowMatch: true })).toThrow();
    const plan = prepareActivitySourceBindings(parsed, [saved('stable')], {
      allowSourceWindowMatch: true, legacyImportedTypes: new Map([['stable', 'Stretching']]),
    });
    expect(parsed.getFirstActivity().getID()).toBe('incoming-0');
    plan.apply();
    expect(parsed.getFirstActivity()).toMatchObject({ type: 'Yoga', sourceIdentity: {
      version: 1, activityId: 'stable', importedType: 'Yoga', startMs: 1000, endMs: 61000,
    } });
    expect(parsed.getFirstActivity().getID()).toBe('stable');
    expect([...plan.verifiedActivityIds]).toEqual(['stable']);
  });

  it('preserves an owner-selected sport separately from the refreshed imported sport', () => {
    const parsed = event();
    const plan = prepareActivitySourceBindings(parsed, [saved('stable', 'Pilates', { sourceIdentity: {
      version: 1, activityId: 'stable', startMs: 1000, endMs: 61000, importedType: 'Stretching',
    } })], { allowSourceWindowMatch: true });
    plan.apply();
    expect(parsed.getFirstActivity().type).toBe('Pilates');
    expect(parsed.getFirstActivity()).toHaveProperty('sourceIdentity.importedType', 'Yoga');
  });

  it('rejects structural ambiguity before changing IDs or provenance', () => {
    const parsed = event();
    expect(() => prepareActivitySourceBindings(parsed, [saved('a'), saved('b')],
      { allowSourceWindowMatch: true })).toThrow();
    expect(parsed.getFirstActivity().getID()).toBe('incoming-0');
    expect(parsed.getFirstActivity()).not.toHaveProperty('sourceIdentity');
  });

  it('matches reordered and reclassified multisport legs without changing IDs or allocating controls by ordinal', () => {
    const parsed = event([ActivityTypes.Yoga, ActivityTypes.Running]);
    const reordered = parsed.getActivities().reverse();
    vi.spyOn(parsed, 'getActivities').mockReturnValue(reordered);
    const docs = [saved('first', 'Pilates', { sourceIdentity: {
      version: 1, activityId: 'first', startMs: 1000, endMs: 61000, importedType: 'Stretching',
    } }), saved('second', 'Running', { startDate: new Date(61000), endDate: new Date(121000) })];
    const plan = prepareActivitySourceBindings(parsed, docs, { allowSourceWindowMatch: true });
    plan.apply();
    expect(parsed.getActivities().map(activity => activity.getID())).toEqual(['second', 'first']);
    expect(parsed.getActivities().map(activity => activity.type)).toEqual(['Running', 'Pilates']);
    expect(parsed.getActivities().map(activity => (activity as any).sourceIdentity.importedType)).toEqual(['Running', 'Yoga']);
  });

  it('rejects overlapping split/merge replacements even when reparse permits new and removed disjoint legs', () => {
    const parsed = event([ActivityTypes.Yoga, ActivityTypes.Running]);
    const combined = saved('combined', 'Yoga', { endDate: new Date(121000) });
    expect(() => prepareActivitySourceBindings(parsed, [combined], { allowNewActivities: true,
      allowRemovedActivities: true, allowSourceWindowMatch: true })).toThrow();
    expect(parsed.getActivities().map(activity => activity.getID())).toEqual(['incoming-0', 'incoming-1']);
  });

  it('does not certify corrections for a different pairing than the saved leg IDs', () => {
    const parsed = event([ActivityTypes.Running, ActivityTypes.Running]);
    Object.assign(parsed.getActivities()[0], { sourceActivityKey: 'second-source' });
    Object.assign(parsed.getActivities()[1], { sourceActivityKey: 'first-source' });
    const plan = prepareActivitySourceBindings(parsed, [
      saved('first', 'Running', { sourceActivityKey: 'first-source' }),
      saved('second', 'Running', { sourceActivityKey: 'second-source', startDate: new Date(61000), endDate: new Date(121000) }),
    ], { allowSourceWindowMatch: true });
    expect(plan.strictAssignments.size).toBe(0);
    plan.apply();
    expect(parsed.getActivities().map(activity => activity.getID())).toEqual(['second', 'first']);
  });

  it('stamps new imports without replacing their chosen IDs', () => {
    const parsed = event([ActivityTypes.Yoga, ActivityTypes.Running]);
    const plan = prepareActivitySourceBindings(parsed, [], { allowNewActivities: true });
    plan.apply();
    expect(parsed.getActivities().map(activity => activity.getID())).toEqual(['incoming-0', 'incoming-1']);
    expect(parsed.getActivities().map(activity => (activity as any).sourceIdentity.importedType)).toEqual(['Yoga', 'Running']);
    expect(plan.verifiedActivityIds.size).toBe(0);
  });
});
