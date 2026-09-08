import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentReference, DocumentSnapshot, Firestore, Query } from 'firebase-admin/firestore';
const { firestoreMock } = vi.hoisted(() => ({ firestoreMock: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: firestoreMock }));
import { createMcpDataService } from './data.service';

// Real SDK query construction and snapshot cursors, with network I/O stubbed.
// Never connect these fixtures to a project or emulator containing user data.
const factory = DocumentSnapshot as typeof DocumentSnapshot & {
  fromObject(ref: DocumentReference, data: Record<string, unknown>): DocumentSnapshot;
};
function selectFields(raw: Record<string, unknown>, fields: string[]) {
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    const parts = field.split('.');
    if (parts.length === 1) {
      if (raw[field] !== undefined) selected[field] = raw[field];
    } else {
      selected[parts[0]] ??= {};
      (selected[parts[0]] as Record<string, unknown>)[parts[1]] = (raw[parts[0]] as Record<string, unknown>)[parts[1]];
    }
  }
  return selected;
}

describe('MCP Health Firestore adapter', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([0, 1, 32, 33])('uses projected owner-scoped SDK cursors for %i source records', async count => {
    const db = new Firestore({ projectId: 'demo-health-pagination' });
    firestoreMock.mockReturnValue(db);
    const select = vi.spyOn(Query.prototype, 'select');
    const where = vi.spyOn(Query.prototype, 'where');
    const startAfter = vi.spyOn(Query.prototype, 'startAfter');
    const docGet = vi.spyOn(DocumentReference.prototype, 'get').mockResolvedValue(
      factory.fromObject(db.doc('users/fixture-owner'), { settings: { unitSettings: {} } }),
    );
    const write = vi.spyOn(DocumentReference.prototype, 'set');
    const collection = db.collection('users').doc('fixture-owner').collection('healthSourceRecords');
    const revision = { order: 1, token: 'private-token', digest: 'private-digest' };
    let offset = 0;
    vi.spyOn(Query.prototype, 'get').mockImplementation(async () => {
      const fields = select.mock.calls.at(-1) as string[];
      const docs = Array.from({ length: Math.min(32, count - offset) }, (_, i) => {
        const raw = {
          userID: 'fixture-owner', schemaVersion: 1, kind: 'daily_summary', calendarDate: '2026-09-01',
          source: { provider: 'SuuntoApp', accountKey: 'private-account', revision, sourceRecordKey: 'private-source' },
          coverage: { status: 'complete' }, sampleChunkIds: [],
          metrics: [{ kind: 'value', metricId: 'heart_rate', aggregation: 'average', semanticVariant: 'daily_average',
            origin: 'provider_summary', recordingMethod: 'provider_calculated', valueType: 'number',
            normalizationStatus: 'canonical', canonical: { value: 60, unit: 'bpm' },
            native: { metric: 'private-native', value: 60 } }],
          device: { displayName: 'private-device' },
        };
        return factory.fromObject(collection.doc(`private-${offset + i}`), selectFields(raw, fields));
      });
      offset += docs.length;
      return { docs } as Awaited<ReturnType<Query['get']>>;
    });
    const result = await createMcpDataService().queryHealthMetric({
      uid: 'fixture-owner', metricId: 'heart_rate', startDate: '2026-09-01', endDate: '2026-09-02',
      mode: 'summaries', maxPoints: 200, measurementsAllowed: false,
    });
    expect(result.recordsRead).toBe(count);
    expect(result.series[0]?.readingCount ?? 0).toBe(count);
    expect(startAfter).toHaveBeenCalledTimes(Math.floor(count / 32));
    expect(where).toHaveBeenCalledWith('metricIds', 'array-contains', 'heart_rate');
    expect(select.mock.calls[0]).toContain('calendarDate');
    expect(select.mock.calls[0]).toContain('source.revision');
    expect(select.mock.calls[0]).not.toContain('source');
    expect(docGet.mock.instances[0].path).toBe('users/fixture-owner');
    expect(write).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/fixture-owner|private-/);
  });

  it('constructs a bounded metric-first sample query with SDK snapshot pagination', async () => {
    const db = new Firestore({ projectId: 'demo-health-chunk-pagination' });
    firestoreMock.mockReturnValue(db);
    const { firestoreHealthReads } = await import('./health.service');
    const where = vi.spyOn(Query.prototype, 'where');
    const select = vi.spyOn(Query.prototype, 'select');
    const limit = vi.spyOn(Query.prototype, 'limit');
    const cursor = factory.fromObject(db.doc('users/owner/healthSampleChunks/private-chunk'), { calendarDate: '2026-09-01' });
    const startAfter = vi.spyOn(Query.prototype, 'startAfter');
    vi.spyOn(Query.prototype, 'get').mockResolvedValue({ docs: [] } as unknown as Awaited<ReturnType<Query['get']>>);
    await firestoreHealthReads.fetchPage({ uid: 'owner', metricId: 'stress_state', startDate: '2026-09-01', endDate: '2026-09-02' },
      'healthSampleChunks', 8, cursor);
    expect(where).toHaveBeenCalledWith('metricId', '==', 'stress_state');
    expect(limit).toHaveBeenCalledWith(8);
    expect(startAfter).toHaveBeenCalledWith(cursor);
    expect(select.mock.calls[0]).toContain('canonicalValues');
    expect(select.mock.calls[0]).not.toContain('nativeValues');
    expect(select.mock.calls[0]).not.toContain('qualityCodes');
  });
});
