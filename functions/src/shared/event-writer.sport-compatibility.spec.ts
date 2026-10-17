import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypesHelper,
  DataActivityTypes,
  DataDuration,
  DataPower,
  DataTrainingStressScore,
  DataTrainingStressScoreMethod,
  EventImporterJSON,
  FileType,
  Privacy,
  TrainingStressScoreMethod,
} from '@sports-alliance/sports-lib';
import { stripStreamsRecursivelyInPlace } from '../../../shared/firestore-write-sanitizer';
import { type AppEventInterface } from '../../../shared/app-event.interface';
import { EventWriter, type FirestoreAdapter } from './event-writer';

// This compatibility contract must exercise the installed JSON reader rather
// than the shared suite's intentionally abbreviated Sports Lib catalog mock.
vi.unmock('@sports-alliance/sports-lib');

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(child => containsKey(child, key));
  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, key) || Object.values(record).some(child => containsKey(child, key));
}

const canonicalSports = ActivityTypesHelper.getActivityTypesAsUniqueArray();

describe('split event/activity persistence preserves canonical sport JSON', () => {
  it.each(canonicalSports)('round-trips %s without replacing provider TSS or storing streams', async sport => {
    for (const tss of [0, 42.375]) {
      for (const method of [undefined, TrainingStressScoreMethod.IMPORTED]) {
        const stats = {
          [DataDuration.type]: 60,
          [DataTrainingStressScore.type]: tss,
          ...(method ? { [DataTrainingStressScoreMethod.type]: method } : {}),
        };
        const event = EventImporterJSON.getEventFromJSON({
          name: 'Synthetic compatibility workout', startDate: 0, endDate: 60_000,
          srcFileType: FileType.JSON, privacy: Privacy.Private, description: null,
          isMerge: false, powerCurve: null, stats: { ...stats, [DataActivityTypes.type]: [sport] },
          activities: [{
            name: null, startDate: 0, endDate: 60_000, type: sport,
            powerMeter: false, trainer: false, powerCurve: null, stats,
            streams: [{ type: DataPower.type, data: [1, null, 3] }], laps: [],
            creator: { name: 'Synthetic device', devices: [] }, intensityZones: [], events: [],
          }],
        }) as AppEventInterface;
        event.setID('event-1');
        const activity = event.getFirstActivity();
        activity.setID('activity-1');
        Object.assign(activity, { sourceActivityKey: 'private-source-key' });
        const writes = new Map<string, Record<string, unknown>>();
        const adapter: FirestoreAdapter = {
          setDoc: vi.fn(async (path, data) => { writes.set(path.join('/'), data as Record<string, unknown>); }),
          generateID: vi.fn(() => 'unexpected-generated-id'),
          createBlob: vi.fn(data => data),
        };
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        await new EventWriter(adapter, undefined, undefined, logger).writeAllEventData('synthetic-user', event);
        const storedEvent = writes.get('users/synthetic-user/events/event-1')!;
        const storedActivity = writes.get('users/synthetic-user/activities/activity-1')!;
        expect(writes.size).toBe(2);
        expect(storedEvent).not.toHaveProperty('activities');
        expect(containsKey(storedEvent, 'streams')).toBe(false);
        expect(containsKey(storedActivity, 'streams')).toBe(false);
        expect(storedActivity).toMatchObject({ type: sport, eventID: 'event-1', userID: 'synthetic-user',
          sourceActivityKey: 'private-source-key', stats });
        expect(adapter.createBlob).not.toHaveBeenCalled();
        // Sanitization must not change the original parse or its null gaps.
        expect(activity.getStream(DataPower.type).getData()).toEqual([1, null, 3]);
        expect(activity.type).toBe(sport);

        const serializedEvent = JSON.parse(JSON.stringify(storedEvent));
        const serializedActivity = JSON.parse(JSON.stringify(storedActivity));
        stripStreamsRecursivelyInPlace(serializedActivity);
        const hydrated = EventImporterJSON.getEventFromJSON({ ...serializedEvent,
          activities: [{ ...serializedActivity, streams: [] }] });
        expect(hydrated.getFirstActivity().type).toBe(sport);
        expect(hydrated.getFirstActivity().getStat(DataTrainingStressScore.type)?.getValue()).toBe(tss);
        expect(hydrated.getStat(DataTrainingStressScore.type)?.getValue()).toBe(tss);
        expect(hydrated.getFirstActivity().getStat(DataTrainingStressScoreMethod.type)?.getValue()).toBe(method);
        expect(EventImporterJSON.getEventFromJSON(JSON.parse(JSON.stringify(hydrated.toJSON())))
          .getFirstActivity().type).toBe(sport);
      }
    }
  });
});
