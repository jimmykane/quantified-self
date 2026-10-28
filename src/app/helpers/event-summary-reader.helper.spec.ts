import { describe, expect, it, vi } from 'vitest';
import { DataDistance, DataSpeedAvg, DataPaceAvg, DynamicDataLoader } from '@sports-alliance/sports-lib/metrics';
import { FileType, Privacy } from '@sports-alliance/sports-lib';
import { AppEventSummary } from '@shared/event-summary';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { serializeTrainingLoadSource } from '@shared/training-load-source';

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
    const revision = event.getReadRevision();
    const stat = event.getDistance()!;
    expect(event.getReadRevision()).toBe(revision);
    stat.setValue(2000);
    expect(event.getReadRevision()).not.toBe(revision);
    const updated = event.getReadRevision();
    expect(event.getReadRevision()).toBe(updated);
    expect(read().getReadRevision()).not.toBe(revision);
  });

  it.each([
    { type: 'Device Names', value: ['Watch'], mutate: (value: any) => value.push('Sensor') },
    { type: 'Start Position', value: { latitudeDegrees: 60, longitudeDegrees: 24 }, mutate: (value: any) => value.latitudeDegrees++ },
  ])('detects nested mutations of selected $type values', ({ type, value, mutate }) => {
    const event = new AppEventSummary({ name: 'Run', startDate: 1000, endDate: 2000, stats: { [type]: value } } as any);
    const stat = event.getStat(type)!;
    const revision = event.getReadRevision();
    mutate(stat.getValue());
    const updated = event.getReadRevision();
    expect(updated).not.toBe(revision);
    expect(event.getReadRevision()).toBe(updated);
    const snapshot = event.getSourceSnapshot();
    expect(snapshot.stats[type]).toEqual(stat.getValue());
    const expected = JSON.parse(JSON.stringify(stat.getValue()));
    mutate(snapshot.stats[type]);
    expect(event.getSourceSnapshot().stats[type]).toEqual(expected);
  });
  it('applies committed scalar patches including zero/removal and keeps lazy derivations out of source snapshots', () => {
    const event = read();
    const original = event.getSourceSnapshot();
    event.getStat(DataPaceAvg.type);
    expect(event.getSourceSnapshot()).toEqual(original);
    const revision = event.getReadRevision();
    event.applySavedStat('Ascent', 0);
    expect(event.getStat('Ascent')?.getValue()).toBe(0);
    expect(event.getReadRevision()).not.toBe(revision);
    expect(event.getSourceSnapshot().stats.Ascent).toBe(0);
    event.applySavedStat('Ascent', null);
    expect(event.getStat('Ascent')).toBeUndefined();
    expect(event.getSourceSnapshot().stats).not.toHaveProperty('Ascent');
  });

  it.each([
    { 'Activity Types': ['Swimming'], 'Average Cadence': 30 },
    { 'Activity Types': ['Diving'], Ascent: 12, Descent: 15 },
    { 'Activity Types': ['Running'], 'Stance Time': 200 },
  ])('preserves persisted fingerprint fields through semantic normalization: %j', stats => {
    const source = { name: 'Source', startDate: 1000, endDate: 2000, stats };
    const event = new AppEventSummary(source as any);
    expect(serializeTrainingLoadSource(event.getSourceSnapshot())).toBe(serializeTrainingLoadSource(source));
    event.getStat('Average Stroke Rate');
    event.getStat('Average Pace');
    event.getStat('Ground Contact Time');
    expect(serializeTrainingLoadSource(event.getSourceSnapshot())).toBe(serializeTrainingLoadSource(source));
  });

  it('captures unsanitized source fields separately without exposing them as metrics or sharing mutable snapshots', () => {
    const source = { type: 'recording', stats: { Distance: 1000, 'Vendor Metric': { samples: [1, 2] } } };
    const event = new AppEventSummary({ name: 'Source', startDate: 1000, endDate: 2000,
      stats: { Distance: 1000 } } as any, source);
    source.stats['Vendor Metric'].samples[0] = 9;
    const snapshot = event.getSourceSnapshot();
    expect(snapshot).toEqual({ startDate: 1000, endDate: 2000, type: 'recording',
      stats: { Distance: 1000, 'Vendor Metric': { samples: [1, 2] } } });
    (snapshot.stats['Vendor Metric'] as { samples: number[] }).samples[0] = 7;
    expect(event.getSourceSnapshot().stats['Vendor Metric']).toEqual({ samples: [1, 2] });
    expect(event.getDistance()?.getValue()).toBe(1000);
    event.getDistance()!.setValue(2000);
    event.getReadRevision();
    expect(event.getSourceSnapshot().stats.Distance).toBe(2000);
  });

});
