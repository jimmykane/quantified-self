import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
} from '@sports-alliance/sports-lib';
import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import {
  buildAiInsightsPromptRepairIdentity,
  buildNormalizedInsightQuerySignature,
  recordSuccessfulAiInsightRepair,
  setAiInsightsPromptRepairBacklogDependenciesForTesting,
  withAiInsightsPromptRepairBacklogDependenciesForTesting,
} from './repaired-prompt-backlog';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

type StoredDoc = Record<string, unknown> | undefined;

class FakeDocumentSnapshot {
  constructor(private readonly storedDoc: StoredDoc) { }

  get exists(): boolean {
    return this.storedDoc !== undefined;
  }

  data(): StoredDoc {
    return this.storedDoc;
  }
}

class FakeDocumentReference {
  constructor(
    private readonly db: FakeFirestore,
    public readonly path: string,
  ) { }
}

class FakeCollectionReference {
  constructor(
    private readonly db: FakeFirestore,
    private readonly path: string,
  ) { }

  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`);
  }
}

class FakeTransaction {
  constructor(private readonly db: FakeFirestore) { }

  async get(docRef: FakeDocumentReference): Promise<FakeDocumentSnapshot> {
    return new FakeDocumentSnapshot(this.db.getDocument(docRef.path));
  }

  set(
    docRef: FakeDocumentReference,
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ): void {
    this.db.setDocument(docRef.path, data, options?.merge === true);
  }

  create(
    docRef: FakeDocumentReference,
    data: Record<string, unknown>,
  ): void {
    this.db.createDocument(docRef.path, data);
  }

  update(
    docRef: FakeDocumentReference,
    data: Record<string, unknown>,
  ): void {
    this.db.updateDocument(docRef.path, data);
  }
}

class FakeFirestore {
  private readonly documents = new Map<string, Record<string, unknown>>();
  readonly operations: Array<'set' | 'create' | 'update'> = [];

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(
    updateFunction: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    return updateFunction(new FakeTransaction(this));
  }

  getDocument(path: string): StoredDoc {
    return this.documents.get(path);
  }

  setDocument(path: string, data: Record<string, unknown>, merge: boolean): void {
    this.operations.push('set');
    const previous = this.documents.get(path);
    this.documents.set(path, merge ? { ...(previous ?? {}), ...data } : { ...data });
  }

  createDocument(path: string, data: Record<string, unknown>): void {
    this.operations.push('create');
    if (this.documents.has(path)) {
      throw new Error(`Document already exists: ${path}`);
    }

    this.documents.set(path, { ...data });
  }

  updateDocument(path: string, data: Record<string, unknown>): void {
    this.operations.push('update');
    const previous = this.documents.get(path);
    if (!previous) {
      throw new Error(`Document does not exist: ${path}`);
    }

    this.documents.set(path, { ...previous, ...data });
  }
}

function buildAggregateQuery(overrides: Partial<NormalizedInsightQuery> = {}): NormalizedInsightQuery {
  return {
    resultKind: 'aggregate',
    dataType: 'Distance',
    valueType: ChartDataValueTypes.Maximum,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: undefined,
    activityTypeGroups: [],
    activityTypes: [ActivityTypes.Cycling],
    dateRange: {
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    },
    chartType: ChartTypes.ColumnsVertical,
    ...overrides,
  };
}

describe('repaired prompt backlog', () => {
  let fakeDb: FakeFirestore;
  let nowIso: string;

  beforeEach(() => {
    fakeDb = new FakeFirestore();
    nowIso = '2026-03-21T00:00:00.000Z';
    setAiInsightsPromptRepairBacklogDependenciesForTesting({
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      now: () => new Date(nowIso),
    });
  });

  afterEach(() => {
    setAiInsightsPromptRepairBacklogDependenciesForTesting();
  });

  it('builds the same intent identity for canonical-equivalent prompts and same query signature', () => {
    const query = buildAggregateQuery();

    const firstIdentity = buildAiInsightsPromptRepairIdentity(
      'show max heartrate by activity type this year',
      query,
    );
    const secondIdentity = buildAiInsightsPromptRepairIdentity(
      'show max heart rate by activity type this year',
      query,
    );

    expect(firstIdentity.canonicalPrompt).toBe(secondIdentity.canonicalPrompt);
    expect(firstIdentity.normalizedQuerySignature).toBe(secondIdentity.normalizedQuerySignature);
    expect(firstIdentity.intentDocID).toBe(secondIdentity.intentDocID);
  });

  it('scopes backlog dependency overrides and restores previous test dependencies', async () => {
    const query = buildAggregateQuery();

    const scopedIdentity = await withAiInsightsPromptRepairBacklogDependenciesForTesting({
      hashText: () => 'scoped-doc-id',
    }, async () => buildAiInsightsPromptRepairIdentity('show max heartrate', query));

    const restoredIdentity = buildAiInsightsPromptRepairIdentity('show max heartrate', query);

    expect(scopedIdentity.intentDocID).toBe('scoped-doc-id');
    expect(restoredIdentity.intentDocID).not.toBe('scoped-doc-id');
  });

  it('increments seenCount and updates lastSeenAt on repeated upserts', async () => {
    const query = buildAggregateQuery();
    const firstRecord = await recordSuccessfulAiInsightRepair({
      rawPrompt: 'show max heartrate',
      repairInputPrompt: 'show max heartrate',
      normalizedQuery: query,
      deterministicFailureReasonCode: 'unsupported_metric',
      metricKey: 'heart_rate',
    });

    nowIso = '2026-03-25T00:00:00.000Z';
    await recordSuccessfulAiInsightRepair({
      rawPrompt: 'show max heartrate',
      repairInputPrompt: 'show max heartrate',
      normalizedQuery: query,
      deterministicFailureReasonCode: 'unsupported_metric',
      metricKey: 'heart_rate',
    });

    const storedDoc = fakeDb.getDocument(`aiInsightsPromptRepairs/${firstRecord.intentDocID}`);
    expect(storedDoc?.seenCount).toBe(2);
    expect(storedDoc?.firstSeenAt).toBe('2026-03-21T00:00:00.000Z');
    expect(storedDoc?.lastSeenAt).toBe('2026-03-25T00:00:00.000Z');
    expect(fakeDb.operations).toEqual(['create', 'update']);
  });

  it('stores canonical/raw/resolved fields and excludes uid fields', async () => {
    const normalizedQuery = buildAggregateQuery({
      dataType: 'Maximum Heart Rate',
      valueType: ChartDataValueTypes.Maximum,
    });

    const record = await recordSuccessfulAiInsightRepair({
      rawPrompt: 'Show my max heart rate last month as stacked columns by activity type over time',
      repairInputPrompt: 'show my max heartrate last month as stacked columns by activity type over time',
      normalizedQuery,
      deterministicFailureReasonCode: 'ambiguous_metric',
      metricKey: 'heart_rate',
    });

    const storedDoc = fakeDb.getDocument(`aiInsightsPromptRepairs/${record.intentDocID}`) as Record<string, unknown>;
    expect(storedDoc.canonicalPrompt).toBe('show my max heart rate last month as stacked columns by activity type over time');
    expect(storedDoc.latestRawPrompt).toBe('Show my max heart rate last month as stacked columns by activity type over time');
    expect(storedDoc.normalizedQuery).toEqual(normalizedQuery);
    expect(storedDoc.metricKey).toBe('heart_rate');
    expect(storedDoc.deterministicFailureReasonCode).toBe('ambiguous_metric');
    expect(storedDoc).not.toHaveProperty('uid');
    expect(storedDoc).not.toHaveProperty('userID');
  });

  it('sets expireAt to 90 days from write time', async () => {
    const query = buildAggregateQuery();

    const record = await recordSuccessfulAiInsightRepair({
      rawPrompt: 'show distance',
      repairInputPrompt: 'show distance',
      normalizedQuery: query,
      deterministicFailureReasonCode: 'invalid_prompt',
      metricKey: 'distance',
    });

    const storedDoc = fakeDb.getDocument(`aiInsightsPromptRepairs/${record.intentDocID}`) as Record<string, unknown>;
    const expireAt = storedDoc.expireAt as Date;
    expect(expireAt.toISOString()).toBe('2026-06-19T00:00:00.000Z');
  });

  it('builds a deterministic normalized query signature', () => {
    const firstSignature = buildNormalizedInsightQuerySignature(buildAggregateQuery({
      dataType: 'Distance',
      valueType: ChartDataValueTypes.Maximum,
    }));
    const secondSignature = buildNormalizedInsightQuerySignature(buildAggregateQuery({
      valueType: ChartDataValueTypes.Maximum,
      dataType: 'Distance',
    }));

    expect(firstSignature).toBe(secondSignature);
  });
});
