import { describe, expect, it, vi } from 'vitest';
import { DataDistance, DataSpeedAvg, DataPaceAvg, DynamicDataLoader } from '@sports-alliance/sports-lib/metrics';
import { FileType, Privacy } from '@sports-alliance/sports-lib';
import { AppEventSummary } from '@shared/event-summary';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';

const read = () => new AppEventSummary({ id: 'summary', name: 'Run', startDate: 0, endDate: 1000,
  srcFileType: FileType.FIT, privacy: Privacy.Private, description: null, isMerge: false,
  stats: { Distance: 1000, 'Average Speed': 4, 'Activity Types': ['Running'] } });

describe('QS event summary reader', () => {
  it('keeps metadata reads free of metric construction and omits full-event APIs', () => {
    const construct = vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType');
    try {
      const event = read();
      expect(event.getID()).toBe('summary');
      expect(event.getActivityTypesAsString()).toBe('Running');
      expect(construct).not.toHaveBeenCalled();
      expect('toJSON' in event).toBe(false);
      expect('getActivities' in event).toBe(false);
      expect(event.getDistance()?.getValue()).toBe(1000);
      expect(construct).toHaveBeenCalledTimes(1);
      expect(event.getStat(DataDistance.type)).toBe(event.getDistance());
    } finally { construct.mockRestore(); }
  });

  it('derives requested pace without eagerly reading unrelated metrics', () => {
    const event = read();
    expect(event.getStat<number>(DataPaceAvg.type)?.getValue()).toBe(250);
    expect(event.getStat<number>(DataSpeedAvg.type)?.getValue()).toBe(4);
    expect(resolveUnitAwareDisplayStat(event.getDistance(), undefined)?.text).toContain('1');
  });

  it('keeps cache revisions stable through first reads and detects later metric mutation', () => {
    const event = read();
    const types = [DataDistance.type];
    const revision = event.getReadRevision(types);
    const stat = event.getDistance()!;
    expect(event.getReadRevision(types)).toBe(revision);
    stat.setValue(2000);
    expect(event.getReadRevision(types)).not.toBe(revision);
    const updated = event.getReadRevision(types);
    expect(event.getReadRevision(types)).toBe(updated);
    expect(read().getReadRevision(types)).not.toBe(revision);
  });
  it('applies committed scalar patches including zero/removal and keeps lazy derivations out of source snapshots', () => {
    const event = read();
    const original = event.getSourceSnapshot();
    event.getStat(DataPaceAvg.type);
    expect(event.getSourceSnapshot()).toEqual(original);
    const revision = event.getReadRevision([]);
    event.applySavedStat('Ascent', 0);
    expect(event.getStat('Ascent')?.getValue()).toBe(0);
    expect(event.getReadRevision([])).not.toBe(revision);
    expect(event.getSourceSnapshot().stats.Ascent).toBe(0);
    event.applySavedStat('Ascent', null);
    expect(event.getStat('Ascent')).toBeUndefined();
    expect(event.getSourceSnapshot().stats).not.toHaveProperty('Ascent');
  });

});
