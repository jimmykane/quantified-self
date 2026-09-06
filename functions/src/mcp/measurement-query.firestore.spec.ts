import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSnapshot, Firestore, Query, type DocumentReference } from 'firebase-admin/firestore';
import {
  HEALTH_METRIC_IDS,
  HEALTH_SOURCE_RECORD_KINDS,
  HEALTH_SOURCE_RECORDS_COLLECTION_ID,
} from '../../../shared/health';

const { firestoreMock } = vi.hoisted(() => ({ firestoreMock: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: firestoreMock }));

import { createMcpDataService } from './data.service';

// Build real SDK snapshots locally so startAfter exercises the SDK's required
// ordering-field checks. Only the network get is stubbed; no emulator or cloud access.
const snapshotFactory = DocumentSnapshot as typeof DocumentSnapshot & {
  fromObject(ref: DocumentReference, data: Record<string, unknown>): DocumentSnapshot;
};

describe('MCP measurement Firestore pagination', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([0, 1, 24, 25, 26, 50])('reads %i measurements through projected SDK cursors', async count => {
    const db = new Firestore({ projectId: 'demo-measurement-pagination' });
    firestoreMock.mockReturnValue(db);
    const selectSpy = vi.spyOn(Query.prototype, 'select');
    const cursorSpy = vi.spyOn(Query.prototype, 'startAfter');
    const collection = db.collection('users').doc('fixture-owner')
      .collection(HEALTH_SOURCE_RECORDS_COLLECTION_ID);
    let offset = 0;
    const getSpy = vi.spyOn(Query.prototype, 'get').mockImplementation(async () => {
      const fields = selectSpy.mock.calls.at(-1) as string[];
      const page = Array.from({ length: Math.min(25, count - offset) }, (_, index) => {
        const number = offset + index;
        const raw = {
          calendarDate: '2026-06-01',
          kind: HEALTH_SOURCE_RECORD_KINDS.PointMeasurement,
          endTimeMs: Date.UTC(2026, 5, 1, 8, number),
          metrics: [{
            kind: 'value',
            metricId: HEALTH_METRIC_IDS.BodyWeight,
            aggregation: 'measurement',
            normalizationStatus: 'canonical',
            canonical: { value: 70 + number, unit: 'kg' },
          }],
          source: { accountKey: 'private-account-canary' },
        };
        return snapshotFactory.fromObject(
          collection.doc(`private-record-${String(number).padStart(3, '0')}`),
          Object.fromEntries(fields.map(field => [field, raw[field as keyof typeof raw]])),
        );
      });
      offset += page.length;
      return { docs: page } as Awaited<ReturnType<Query['get']>>;
    });

    const result = await createMcpDataService().queryMeasurements({
      uid: 'fixture-owner',
      measurementType: 'body_weight',
      startTimeMs: Date.UTC(2026, 5, 1),
      endTimeMs: Date.UTC(2026, 5, 2),
      aggregation: 'latest',
      interval: 'day',
      timeZone: 'UTC',
    });

    expect(result.measurementCount).toBe(count);
    expect(getSpy).toHaveBeenCalledTimes(Math.floor(count / 25) + 1);
    expect(cursorSpy).toHaveBeenCalledTimes(Math.floor(count / 25));
    expect(selectSpy).toHaveBeenCalledWith('calendarDate', 'kind', 'endTimeMs', 'metrics');
    expect(JSON.stringify(result)).not.toMatch(/private-record|private-account-canary|fixture-owner|calendarDate/);
    if (count) expect(result.points[0].value).toBe(70 + count - 1);
  });
});
