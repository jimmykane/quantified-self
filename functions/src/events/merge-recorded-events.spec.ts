import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ActivityUtilities, DataPause, EventImporterJSON } from '@sports-alliance/sports-lib';
import { mergeRecordedEvents, mergedActivityId } from './merge-recorded-events';

function event(id: string, method: string, score: number, start = Date.UTC(2026, 0, 1)) {
  const result = EventImporterJSON.getEventFromJSON({ name: 'Recorded', startDate: start, endDate: start + 3600000,
    activities: [{ startDate: start, endDate: start + 3600000, type: 'Cycling', creator: { name: 'Test' },
      laps: [], intensityZones: [], streams: [], stats: { Duration: 3600, [DataPause.type]: 0, Distance: 10000, Energy: 210, Weight: 70,
        'Training Stress Score': score, 'Training Stress Score Method': method } }] } as any).setID(id);
  result.getFirstActivity().setID('leg');
  return result;
}

describe('merging recorded activity statistics', () => {
  it.each(['POWER', 'HR', 'MET', 'PACE', 'IMPORTED'])('preserves %s provenance without evaluating streamless sources', method => {
    const evaluate = vi.spyOn(ActivityUtilities, 'getTrainingStressScoreEvaluations');
    const generate = vi.spyOn(ActivityUtilities, 'generateMissingStreamsAndStatsForActivity');
    try {
      const sources = [event('a', method, 100), event('b', 'IMPORTED', 0)];
      const before = sources.map(source => source.getFirstActivity().getStatsAsArray().map(stat => [stat.getType(), stat.getValue()]));
      const merged = mergeRecordedEvents(sources, 'merged');
      expect(merged.getActivities().map(activity => activity.getStatsAsArray().map(stat => [stat.getType(), stat.getValue()]))).toEqual(before);
      expect(merged.getActivities().map(activity => activity.getID())).toEqual([
        mergedActivityId('merged', 'a', 'leg'), mergedActivityId('merged', 'b', 'leg')]);
      expect(evaluate).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(merged.getActivities().every(activity => activity.getAllStreams().length === 0)).toBe(true);
    } finally { evaluate.mockRestore(); generate.mockRestore(); }
  });
  it('uses stable distinct IDs for retries, reversed input, and same-named legs across sources', () => {
    const build = (reverse: boolean) => mergeRecordedEvents((reverse
      ? [event('b', 'HR', 100, Date.UTC(2026, 0, 2)), event('a', 'POWER', 100)]
      : [event('a', 'POWER', 100), event('b', 'HR', 100, Date.UTC(2026, 0, 2))]), 'merged');
    expect(build(false).getActivities().map(a => a.getID())).toEqual(build(true).getActivities().map(a => a.getID()));
    expect(new Set(build(false).getActivities().map(a => a.getID())).size).toBe(2);
  });
});
