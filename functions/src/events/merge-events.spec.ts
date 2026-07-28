import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { USAGE_LIMITS } from '../../../shared/limits';

const hoisted = vi.hoisted(() => {
  let onCallOptions: unknown = null;
  const state = {
    eventCount: 0,
    eventDocs: new Map<string, Record<string, unknown>>(),
    activitiesByEventID: new Map<string, Array<{ id: string; data: Record<string, unknown> }>>(),
    fileBytesByPath: new Map<string, Buffer>(),
    fileBytesByBucketAndPath: new Map<string, Buffer>(),
    downloadErrorByBucketAndPath: new Map<string, Error & { code?: unknown }>(),
    downloadAttempts: [] as string[],
    missingFilePaths: new Set<string>(),
    throwOnDefaultBucketLookup: false,
    exerciseWriterAdaptersOnce: false,
  };

  const mockHasProAccess = vi.fn();
  const mockHasBasicAccess = vi.fn();
  const mockAssertEventWriteUserActive = vi.fn();
  const mockSetEventDocumentIfUserActive = vi.fn();
  const mockDocSet = vi.fn();
  const mockOperationSet = vi.fn();
  const mockWriteAllEventData = vi.fn();
  const mockGenerateMergeEventID = vi.fn(() => 'merged-event-id');
  const mockSportsLibVersionToCode = vi.fn(() => 9001004);
  const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
  const mockStorageSave = vi.fn();
  const mockStorageGetMetadata = vi.fn();

  function makeEvent(json: Record<string, unknown>) {
    const eventState = {
      id: `${json.id || ''}`,
      activities: [] as any[],
      description: `${json.description || ''}`,
      startDate: json.startDate ? new Date(`${json.startDate}`) : new Date('2026-01-10T10:00:00.000Z'),
    };

    const event: any = {
      ...json,
      startDate: eventState.startDate,
      getID: vi.fn(() => eventState.id),
      setID: vi.fn((id: string) => {
        eventState.id = id;
        return event;
      }),
      getActivities: vi.fn(() => eventState.activities),
      clearActivities: vi.fn(() => {
        eventState.activities = [];
      }),
      addActivities: vi.fn((activities: any[]) => {
        eventState.activities = [...eventState.activities, ...activities];
      }),
      setDescription: vi.fn((description: string) => {
        eventState.description = description;
        event.description = description;
      }),
      description: eventState.description,
    };

    return event;
  }

  function makeActivity(json: Record<string, unknown>) {
    let activityID = `${json.id || ''}`;
    const activity: any = {
      ...json,
      creator: json.creator || { name: 'Garmin' },
      getID: vi.fn(() => activityID),
      setID: vi.fn((id: string) => {
        activityID = id;
        return activity;
      }),
    };

    return activity;
  }

  const mockEventImporterJSON = {
    getEventFromJSON: vi.fn((json: Record<string, unknown>) => makeEvent(json)),
    getActivityFromJSON: vi.fn((json: Record<string, unknown>) => makeActivity(json)),
  };

  const mockMergeEvents = vi.fn((events: any[]) => {
    const mergedEvent = makeEvent({ description: 'A merge of 2 or more activities ' });
    const mergedActivities = events.flatMap((event) => event.getActivities());
    mergedEvent.clearActivities();
    mergedEvent.addActivities(mergedActivities);
    return mergedEvent;
  });

    return {
      state,
      mockHasProAccess,
      mockHasBasicAccess,
      mockAssertEventWriteUserActive,
      mockSetEventDocumentIfUserActive,
      mockDocSet,
      mockOperationSet,
      mockWriteAllEventData,
      mockGenerateMergeEventID,
      mockSportsLibVersionToCode,
      mockServerTimestamp,
      mockStorageSave,
      mockStorageGetMetadata,
      mockEventImporterJSON,
      mockMergeEvents,
      makeEvent,
      getOnCallOptions: () => onCallOptions,
      setOnCallOptions: (options: unknown) => {
        onCallOptions = options;
      },
    };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (options: unknown, handler: unknown) => {
    hoisted.setOnCallOptions(options);
    return handler;
  },
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('firebase-admin', () => {
  const firestoreFn = vi.fn(() => ({
    collection: (path: string) => {
      if (path === 'users') {
        return {
          doc: (id?: string) => {
            if (id) {
              return {
                collection: (name: string) => {
                  if (name === 'events') {
                    return {
                      count: () => ({
                        get: async () => ({ data: () => ({ count: hoisted.state.eventCount }) }),
                      }),
                    };
                  }
                  return {};
                },
              };
            }
            return { id: hoisted.mockGenerateMergeEventID() };
          },
        };
      }

      if (path.startsWith('users/') && path.endsWith('/activities')) {
        return {
          where: (_field: string, _operator: string, eventID: string) => ({
            get: async () => ({
              docs: (hoisted.state.activitiesByEventID.get(eventID) || []).map((entry) => ({
                id: entry.id,
                data: () => entry.data,
              })),
            }),
          }),
        };
      }

      if (path === 'tmp') {
        return {
          doc: () => ({ id: 'tmp-generated-id' }),
        };
      }

      return { doc: () => ({}) };
    },
    doc: (path: string) => ({
      path,
      get: async () => {
        const data = hoisted.state.eventDocs.get(path);
        if (!data) {
          return { exists: false, data: () => undefined };
        }
        return { exists: true, data: () => data };
      },
      set: hoisted.mockDocSet,
    }),
  }));

  Object.assign(firestoreFn, {
    FieldValue: {
      serverTimestamp: hoisted.mockServerTimestamp,
    },
  });

  return {
    firestore: firestoreFn,
    storage: () => ({
      bucket: (bucketName?: string) => ({
        name: (() => {
          if (!bucketName && hoisted.state.throwOnDefaultBucketLookup) {
            throw new Error('default bucket lookup failed');
          }
          return bucketName || 'quantified-self-io';
        })(),
        file: (path: string) => ({
          download: async () => {
            const resolvedBucket = bucketName || 'quantified-self-io';
            const scopedKey = `${resolvedBucket}:${path}`;
            hoisted.state.downloadAttempts.push(scopedKey);

            const scopedError = hoisted.state.downloadErrorByBucketAndPath.get(scopedKey);
            if (scopedError) {
              throw scopedError;
            }
            if (hoisted.state.missingFilePaths.has(path)) {
              const error = new Error('No such object');
              (error as Error & { code?: number }).code = 404;
              throw error;
            }
            const bytes = hoisted.state.fileBytesByBucketAndPath.get(scopedKey)
              || hoisted.state.fileBytesByPath.get(path)
              || Buffer.from('default-file-content');
            return [bytes];
          },
          save: hoisted.mockStorageSave,
          getMetadata: hoisted.mockStorageGetMetadata,
        }),
      }),
    }),
  };
});

vi.mock('@sports-alliance/sports-lib', () => ({
  EventImporterJSON: hoisted.mockEventImporterJSON,
  EventUtilities: {
    mergeEvents: (...args: unknown[]) => hoisted.mockMergeEvents(...args),
  },
}));

vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  assertEventWriteUserActive: (...args: unknown[]) => hoisted.mockAssertEventWriteUserActive(...args),
  enforceAppCheck: (request: { app?: unknown }) => {
    if (!request.app) {
      throw new Error('App Check verification failed.');
    }
  },
  hasProAccess: (...args: unknown[]) => hoisted.mockHasProAccess(...args),
  hasBasicAccess: (...args: unknown[]) => hoisted.mockHasBasicAccess(...args),
  setEventDocumentIfUserActive: (...args: unknown[]) => hoisted.mockSetEventDocumentIfUserActive(...args),
}));

vi.mock('../shared/event-writer', () => ({
  EventWriter: vi.fn((firestoreAdapter: any, storageAdapter: any) => ({
    writeAllEventData: async (...args: unknown[]) => {
      if (hoisted.state.exerciseWriterAdaptersOnce) {
        hoisted.state.exerciseWriterAdaptersOnce = false;
        await firestoreAdapter.setDoc(['users', `${args[0]}`, 'events', 'adapter-probe'], { probe: true });
        await storageAdapter.uploadFile('users/probe/events/adapter-probe/original.fit', Buffer.from([0x09]));
      }
      return hoisted.mockWriteAllEventData(...args);
    },
  })),
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
  sportsLibVersionToCode: (...args: unknown[]) => hoisted.mockSportsLibVersionToCode(...args),
}));

vi.mock('../../../shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: {
    mergeEvents: { name: 'mergeEvents', region: 'europe-west2' },
  },
}));

import { mergeEvents } from './merge-events';

function hasNestedStreamsKey(value: unknown, isRoot: boolean = true): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(item => hasNestedStreamsKey(item, false));
  }

  if (typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (key === 'streams' && !isRoot) {
      return true;
    }
    if (hasNestedStreamsKey(child, false)) {
      return true;
    }
  }

  return false;
}

function seedTwoEvents(): void {
  hoisted.state.eventDocs.set('users/u1/events/e1', {
    startDate: new Date('2026-01-10T10:00:00.000Z'),
    description: 'Morning run',
    originalFiles: [
      {
        path: 'users/u1/events/e1/original.fit',
        bucket: 'quantified-self-io',
        startDate: new Date('2026-01-10T10:00:00.000Z'),
      },
    ],
  });
  hoisted.state.eventDocs.set('users/u1/events/e2', {
    startDate: new Date('2026-01-11T10:00:00.000Z'),
    description: 'Evening run',
    originalFiles: [
      {
        path: 'users/u1/events/e2/original.gpx.gz',
        bucket: 'quantified-self-io',
        startDate: new Date('2026-01-11T10:00:00.000Z'),
      },
    ],
  });

  hoisted.state.activitiesByEventID.set('e1', [
    {
      id: 'a1',
      data: {
        startDate: new Date('2026-01-10T10:00:00.000Z'),
        creator: { name: 'Garmin' },
      },
    },
  ]);

  hoisted.state.activitiesByEventID.set('e2', [
    {
      id: 'a2',
      data: {
        startDate: new Date('2026-01-11T10:00:00.000Z'),
        creator: { name: 'Suunto' },
      },
    },
  ]);

  hoisted.state.fileBytesByPath.set('users/u1/events/e1/original.fit', Buffer.from([0x01, 0x02]));
  hoisted.state.fileBytesByPath.set('users/u1/events/e2/original.gpx.gz', Buffer.from([0x03, 0x04]));
}

describe('mergeEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hoisted.state.eventCount = 0;
    hoisted.state.eventDocs.clear();
    hoisted.state.activitiesByEventID.clear();
    hoisted.state.fileBytesByPath.clear();
    hoisted.state.fileBytesByBucketAndPath.clear();
    hoisted.state.downloadErrorByBucketAndPath.clear();
    hoisted.state.downloadAttempts = [];
    hoisted.state.missingFilePaths.clear();
    hoisted.state.throwOnDefaultBucketLookup = false;
    hoisted.state.exerciseWriterAdaptersOnce = false;

    hoisted.mockHasProAccess.mockResolvedValue(false);
    hoisted.mockHasBasicAccess.mockResolvedValue(false);
    hoisted.mockAssertEventWriteUserActive.mockResolvedValue(undefined);
    hoisted.mockDocSet.mockResolvedValue(undefined);
    hoisted.mockOperationSet.mockResolvedValue(undefined);
    hoisted.mockGenerateMergeEventID.mockReturnValue('merged-event-id');
    hoisted.mockSetEventDocumentIfUserActive.mockImplementation(
      async (
        _userID: unknown,
        _phase: unknown,
        docRef: { path?: string },
        data: unknown,
        options?: unknown,
        transformExistingData?: (incomingData: unknown, existingData: unknown) => unknown,
      ) => {
        if (docRef.path?.includes('/eventMergeOperations/')) {
          const existingData = hoisted.state.eventDocs.get(docRef.path) || null;
          const resolvedData = transformExistingData
            ? transformExistingData(data, existingData)
            : data;
          hoisted.state.eventDocs.set(docRef.path, resolvedData as Record<string, unknown>);
          return hoisted.mockOperationSet(resolvedData, options);
        }
        return hoisted.mockDocSet(data, options);
      },
    );
    hoisted.mockWriteAllEventData.mockImplementation(async (userID: string, event: { getID: () => string }) => {
      hoisted.state.eventDocs.set(`users/${userID}/events/${event.getID()}`, {
        id: event.getID(),
      });
    });
    hoisted.mockStorageSave.mockResolvedValue(undefined);
    hoisted.mockStorageGetMetadata.mockResolvedValue([{ generation: 'storage-generation-1' }]);

    seedTwoEvents();
  });

  it('should register with activity processing runtime limits', () => {
    expect(hoisted.getOnCallOptions()).toMatchObject({
      memory: '4GiB',
      cpu: 2,
      concurrency: 1,
      timeoutSeconds: 3600,
      maxInstances: 20,
    });
  });

  it('should fail closed before reads, parsing, storage, or writes when account deletion starts', async () => {
    hoisted.mockAssertEventWriteUserActive.mockRejectedValueOnce(new Error('deletion in progress'));

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as never)).rejects.toMatchObject({ code: 'internal' });

    expect(hoisted.mockAssertEventWriteUserActive).toHaveBeenCalledWith('u1', 'merge_event_start');
    expect(hoisted.mockEventImporterJSON.getEventFromJSON).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockSetEventDocumentIfUserActive).not.toHaveBeenCalled();
  });

  it('should reject unauthenticated requests', async () => {
    await expect(mergeEvents({
      auth: null,
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('should reject requests without app check', async () => {
    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: undefined,
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toThrow('App Check verification failed.');
  });

  it('should validate payload', async () => {
    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e1'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: Array.from({ length: 11 }).map((_, index) => `e${index}`), mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'invalid' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: 'e1,e2', mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1/activities/a1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'x'.repeat(129)], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2\nforged'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 2], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('should enforce ownership by user-scoped event paths', async () => {
    hoisted.state.eventDocs.delete('users/u1/events/e2');

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'not-found' });

    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockSetEventDocumentIfUserActive).not.toHaveBeenCalled();
    expect(
      [...hoisted.state.eventDocs.keys()].some(path => path.includes('/eventMergeOperations/')),
    ).toBe(false);
  });

  it('should enforce free/basic upload limits and bypass for pro/grace', async () => {
    hoisted.state.eventCount = USAGE_LIMITS.free;

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'resource-exhausted' });

    hoisted.mockHasBasicAccess.mockResolvedValue(true);
    hoisted.state.eventCount = USAGE_LIMITS.basic;
    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'resource-exhausted' });

    hoisted.mockHasProAccess.mockResolvedValue(true);
    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).resolves.toMatchObject({ eventId: 'merged-event-id' });
  });

  it('should fail whole merge when a source file is missing', async () => {
    hoisted.state.missingFilePaths.add('users/u1/events/e2/original.gpx.gz');

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('should reject merge when selected events reference duplicate source file paths', async () => {
    hoisted.state.eventDocs.set('users/u1/events/e2', {
      startDate: new Date('2026-01-11T10:00:00.000Z'),
      description: 'Evening run',
      originalFiles: [
        {
          path: 'users/u1/events/e1/original.fit',
          bucket: 'quantified-self-io',
          startDate: new Date('2026-01-11T10:00:00.000Z'),
        },
      ],
    });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'already-exists' });

    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('should reject merge when selected source files have identical content', async () => {
    hoisted.state.fileBytesByPath.set('users/u1/events/e2/original.gpx.gz', Buffer.from([0x01, 0x02]));

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'already-exists' });

    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('should reject merge when gzip-wrapped source content matches an uncompressed source file', async () => {
    const sharedPayload = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    hoisted.state.eventDocs.set('users/u1/events/e2', {
      startDate: new Date('2026-01-11T10:00:00.000Z'),
      description: 'Evening run',
      originalFiles: [
        {
          path: 'users/u1/events/e2/original.fit.gz',
          bucket: 'quantified-self-io',
          startDate: new Date('2026-01-11T10:00:00.000Z'),
        },
      ],
    });
    hoisted.state.fileBytesByPath.set('users/u1/events/e1/original.fit', sharedPayload);
    hoisted.state.fileBytesByPath.set('users/u1/events/e2/original.fit.gz', gzipSync(sharedPayload));

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'already-exists' });

    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('should merge events and return normalized payload', async () => {
    const result = await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);

    expect(hoisted.mockMergeEvents).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);

    const writeArgs = hoisted.mockWriteAllEventData.mock.calls[0];
    expect(writeArgs[0]).toBe('u1');
    expect(writeArgs[2]).toHaveLength(2);
    expect(writeArgs[2][0]).toMatchObject({ extension: 'fit' });
    expect(writeArgs[2][1]).toMatchObject({ extension: 'gpx.gz' });

    expect(result).toEqual({
      eventId: 'merged-event-id',
      mergeType: 'benchmark',
      sourceEventsCount: 2,
      sourceFilesCount: 2,
      activitiesCount: 2,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 1,
    });
  });

  it('should replay the completed response for the same semantic request', async () => {
    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };

    const firstResult = await mergeEvents(request as any);
    const replayedResult = await mergeEvents(request as any);

    expect(replayedResult).toEqual(firstResult);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(hoisted.mockMergeEvents).toHaveBeenCalledTimes(1);

    const operationEntries = [...hoisted.state.eventDocs.entries()]
      .filter(([path]) => path.includes('/eventMergeOperations/'));
    expect(operationEntries).toHaveLength(1);
    expect(operationEntries[0][1]).toMatchObject({
      status: 'completed',
      resultEventId: 'merged-event-id',
      sourceEventsCount: 2,
    });
    expect(operationEntries[0][1]).not.toHaveProperty('eventIds');
    expect(operationEntries[0][1]).not.toHaveProperty('eventIDs');
  });

  it('should return the canonical stored response when completion already won the race', async () => {
    hoisted.mockWriteAllEventData.mockImplementationOnce(
      async (userID: string, event: { getID: () => string }) => {
        const eventID = event.getID();
        hoisted.state.eventDocs.set(`users/${userID}/events/${eventID}`, { id: eventID });
        const operationEntry = [...hoisted.state.eventDocs.entries()]
          .find(([path]) => path.includes('/eventMergeOperations/'));
        expect(operationEntry).toBeDefined();
        hoisted.state.eventDocs.set(operationEntry![0], {
          ...operationEntry![1],
          status: 'completed',
          ownerToken: null,
          leaseExpiresAtMs: 0,
          response: {
            eventId: eventID,
            mergeType: 'benchmark',
            sourceEventsCount: 2,
            sourceFilesCount: 7,
            activitiesCount: 8,
            uploadLimit: USAGE_LIMITS.free,
            uploadCountAfterWrite: 9,
          },
          lastErrorCode: null,
        });
      },
    );

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).resolves.toMatchObject({
      eventId: 'merged-event-id',
      sourceFilesCount: 7,
      activitiesCount: 8,
      uploadCountAfterWrite: 9,
    });
  });

  it('should reconcile operation state when the completion write rejects', async () => {
    hoisted.mockOperationSet
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('completion write failed'))
      .mockResolvedValueOnce(undefined);

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'internal' });

    expect(hoisted.mockOperationSet).toHaveBeenCalledTimes(3);
  });

  it('should replay a completed result even when a source event was later deleted', async () => {
    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };

    const firstResult = await mergeEvents(request as any);
    hoisted.state.eventDocs.delete('users/u1/events/e2');

    await expect(mergeEvents(request as any)).resolves.toEqual(firstResult);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
  });

  it('should reject stored operation state that does not match the request', async () => {
    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };

    await mergeEvents(request as any);
    const operationEntry = [...hoisted.state.eventDocs.entries()]
      .find(([path]) => path.includes('/eventMergeOperations/'));
    expect(operationEntry).toBeDefined();
    hoisted.state.eventDocs.set(operationEntry![0], {
      ...operationEntry![1],
      mergeType: 'multi',
    });

    await expect(mergeEvents(request as any)).rejects.toMatchObject({ code: 'internal' });
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
  });

  it('should reject stored operation state with an invalid lease value', async () => {
    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };

    await mergeEvents(request as any);
    const operationEntry = [...hoisted.state.eventDocs.entries()]
      .find(([path]) => path.includes('/eventMergeOperations/'));
    expect(operationEntry).toBeDefined();
    hoisted.state.eventDocs.set(operationEntry![0], {
      ...operationEntry![1],
      leaseExpiresAtMs: Number.POSITIVE_INFINITY,
    });

    await expect(mergeEvents(request as any)).rejects.toMatchObject({ code: 'internal' });
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
  });

  it('should treat a reversed source selection as the same merge request', async () => {
    const firstResult = await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);
    const replayedResult = await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e2', 'e1'], mergeType: 'benchmark' },
    } as any);

    expect(replayedResult).toEqual(firstResult);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
  });

  it('should reject a concurrent duplicate while the first merge owns the lease', async () => {
    let releaseWrite: (() => void) | undefined;
    const blockedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    hoisted.mockWriteAllEventData.mockImplementationOnce(async () => blockedWrite);

    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };
    const firstMerge = mergeEvents(request as any);
    await vi.waitFor(() => {
      expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    });

    await expect(mergeEvents(request as any)).rejects.toMatchObject({ code: 'aborted' });

    releaseWrite?.();
    await expect(firstMerge).resolves.toMatchObject({ eventId: 'merged-event-id' });
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
  });

  it('should keep the operation lease active for the callable runtime', async () => {
    let releaseWrite: (() => void) | undefined;
    const blockedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    hoisted.mockWriteAllEventData.mockImplementationOnce(async () => blockedWrite);

    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };
    const mergeStartedAtMs = Date.now();
    const firstMerge = mergeEvents(request as any);
    let nowSpy: ReturnType<typeof vi.spyOn> | undefined;

    try {
      await vi.waitFor(() => {
        expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
      });

      nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
        mergeStartedAtMs + (3600 * 1000),
      );
      await expect(mergeEvents(request as any)).rejects.toMatchObject({ code: 'aborted' });
      expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy?.mockRestore();
      releaseWrite?.();
      await firstMerge.catch(() => undefined);
    }

    await expect(firstMerge).resolves.toMatchObject({ eventId: 'merged-event-id' });
  });

  it('should reuse the claimed result ID after an ambiguous write failure', async () => {
    hoisted.mockGenerateMergeEventID
      .mockReturnValueOnce('merge-result-1')
      .mockReturnValueOnce('merge-result-2');
    hoisted.mockWriteAllEventData.mockRejectedValueOnce(new Error('connection reset after write started'));

    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };
    await expect(mergeEvents(request as any)).rejects.toMatchObject({ code: 'internal' });
    await expect(mergeEvents(request as any)).resolves.toMatchObject({ eventId: 'merge-result-1' });

    expect(hoisted.mockGenerateMergeEventID).toHaveBeenCalledTimes(2);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(2);
    const retriedEvent = hoisted.mockWriteAllEventData.mock.calls[1][1] as { getID: () => string };
    expect(retriedEvent.getID()).toBe('merge-result-1');
  });

  it('should rebuild a deliberately deleted result without allocating a second result ID', async () => {
    const request = {
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    };
    await mergeEvents(request as any);
    hoisted.state.eventDocs.delete('users/u1/events/merged-event-id');

    await expect(mergeEvents(request as any)).resolves.toMatchObject({ eventId: 'merged-event-id' });

    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(2);
    expect(hoisted.mockGenerateMergeEventID).toHaveBeenCalledTimes(2);
  });

  it('should strip nested streams and inject stream-less parser defaults', async () => {
    hoisted.state.activitiesByEventID.set('e1', [
      {
        id: 'a1',
        data: {
          startDate: new Date('2026-01-10T10:00:00.000Z'),
          creator: { name: 'Garmin' },
          streams: [{ type: 'Power', values: [100, 200, 150] }],
          laps: [{ split: 1, streams: [{ type: 'Pace', values: [1, 2] }] }],
          nested: {
            details: {
              streams: [{ type: 'HeartRate', values: [150, 151] }],
            },
          },
        },
      },
    ]);

    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);

    expect(hoisted.mockEventImporterJSON.getActivityFromJSON).toHaveBeenCalledTimes(2);
    const firstCallPayload = hoisted.mockEventImporterJSON.getActivityFromJSON.mock.calls[0][0];
    expect(firstCallPayload).toMatchObject({
      stats: {},
      laps: [{ split: 1 }],
      streams: [],
      intensityZones: [],
      events: [],
    });
    expect(hasNestedStreamsKey(firstCallPayload)).toBe(false);
  });

  it('should support legacy originalFile metadata fallback', async () => {
    hoisted.state.eventDocs.set('users/u1/events/e2', {
      startDate: new Date('2026-01-11T10:00:00.000Z'),
      description: 'Evening run',
      originalFile: {
        path: 'users/u1/events/e2/original.tcx',
        bucket: 'quantified-self-io',
        startDate: new Date('2026-01-11T10:00:00.000Z'),
      },
    });
    hoisted.state.fileBytesByPath.set('users/u1/events/e2/original.tcx', Buffer.from([0x04, 0x05]));

    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);

    const writeArgs = hoisted.mockWriteAllEventData.mock.calls[0];
    expect(writeArgs[2]).toHaveLength(2);
    expect(writeArgs[2][1]).toMatchObject({ extension: 'tcx' });
  });

  it('should return failed-precondition when selected event has no original source files', async () => {
    hoisted.state.eventDocs.set('users/u1/events/e2', {
      startDate: new Date('2026-01-11T10:00:00.000Z'),
      description: 'Evening run',
    });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('should parse and persist multi merges with isMerge=false', async () => {
    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'multi' },
    } as any);

    const writeArgs = hoisted.mockWriteAllEventData.mock.calls[0];
    const mergedEvent = writeArgs[1] as { isMerge?: boolean; mergeType?: string; description?: string };
    expect(mergedEvent.isMerge).toBe(false);
    expect(mergedEvent.mergeType).toBe('multi');
    expect(mergedEvent.description).toBe('');
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      isMerge: false,
      mergeType: 'multi',
    }, { merge: true });
    expect(hoisted.mockSetEventDocumentIfUserActive).toHaveBeenCalledWith(
      'u1',
      'merge_event_metadata',
      expect.anything(),
      { isMerge: false, mergeType: 'multi' },
      { merge: true },
    );
    expect(hoisted.mockSetEventDocumentIfUserActive).toHaveBeenCalledWith(
      'u1',
      'merge_event_processing_metadata',
      expect.anything(),
      expect.objectContaining({ processingEntity: 'event' }),
      { merge: true },
    );
  });

  it('should surface merge classification finalization failures after writing the merged event', async () => {
    hoisted.mockDocSet.mockRejectedValueOnce(new Error('metadata write failed'));

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'internal' });

    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      isMerge: true,
      mergeType: 'benchmark',
    }, { merge: true });
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      processingEntity: 'event',
      sportsLibVersion: expect.any(String),
      sportsLibVersionCode: 9001004,
      processedAt: 'SERVER_TIMESTAMP',
    }, { merge: true });
  });

  it('should surface processing metadata finalization failures after writing the merged event', async () => {
    hoisted.mockDocSet
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('processing metadata write failed'));

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'internal' });

    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      isMerge: true,
      mergeType: 'benchmark',
    }, { merge: true });
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      processingEntity: 'event',
      sportsLibVersion: expect.any(String),
      sportsLibVersionCode: 9001004,
      processedAt: 'SERVER_TIMESTAMP',
    }, { merge: true });
  });

  it('should map source event parse failures to internal HttpsError', async () => {
    hoisted.mockEventImporterJSON.getEventFromJSON.mockImplementationOnce(() => {
      throw new Error('parse failure');
    });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'internal' });
  });

  it('should map unexpected merge failures to internal HttpsError', async () => {
    hoisted.mockMergeEvents.mockImplementationOnce(() => {
      throw new Error('unexpected merge crash');
    });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'internal' });
  });

  it('should trim event IDs and parse timestamp-like source dates', async () => {
    hoisted.state.eventDocs.set('users/u1/events/e1', {
      startDate: { seconds: 1768046400, nanoseconds: 123000000 },
      originalFiles: [
        {
          path: 'users/u1/events/e1/original.fit',
          bucket: '  ',
          startDate: { toMillis: () => 1768046400000 },
          originalFilename: 'run.fit',
        },
      ],
    });
    hoisted.state.eventDocs.set('users/u1/events/e2', {
      startDate: { toDate: () => new Date('2026-01-11T10:00:00.000Z') },
      originalFiles: [
        {
          path: 'users/u1/events/e2/original.json.gz',
          bucket: 'quantified-self-io',
          startDate: { toDate: () => new Date('2026-01-11T10:00:00.000Z') },
          originalFilename: 'run.json',
        },
      ],
    });
    hoisted.state.activitiesByEventID.set('e1', [
      { id: 'a1', data: { startDate: '2026-01-10T10:00:00.000Z', creator: { name: 'Garmin' } } },
    ]);
    hoisted.state.activitiesByEventID.set('e2', [
      { id: 'a2', data: { startDate: 1768132800000, creator: { name: 'Suunto' } } },
    ]);
    hoisted.state.fileBytesByPath.set('users/u1/events/e2/original.json.gz', Buffer.from([0x07]));

    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: [' e1 ', ' e2 '], mergeType: 'benchmark' },
    } as any);

    const writeArgs = hoisted.mockWriteAllEventData.mock.calls[0];
    expect(writeArgs[2][0].startDate).toBeInstanceOf(Date);
    expect(writeArgs[2][0].originalFilename).toBe('run.fit');
    expect(writeArgs[2][1]).toMatchObject({ extension: 'json.gz', originalFilename: 'run.json' });
  });

  it('should fallback across candidate buckets on object-not-found errors', async () => {
    hoisted.state.eventDocs.set('users/u1/events/e1', {
      startDate: new Date('2026-01-10T10:00:00.000Z'),
      originalFiles: [{
        path: 'users/u1/events/e1/original.fit',
        bucket: 'custom-bucket',
        startDate: new Date('2026-01-10T10:00:00.000Z'),
      }],
    });

    const notFoundError = new Error('No such object');
    (notFoundError as Error & { code?: string }).code = 'storage/object-not-found';
    hoisted.state.downloadErrorByBucketAndPath.set('custom-bucket:users/u1/events/e1/original.fit', notFoundError as Error & { code?: unknown });
    hoisted.state.fileBytesByBucketAndPath.set('quantified-self-io:users/u1/events/e1/original.fit', Buffer.from([0xaa]));

    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);

    expect(hoisted.state.downloadAttempts).toContain('custom-bucket:users/u1/events/e1/original.fit');
    expect(hoisted.state.downloadAttempts).toContain('quantified-self-io:users/u1/events/e1/original.fit');
  });

  it('should map non-not-found storage errors to failed-precondition', async () => {
    const permissionError = new Error('Permission denied');
    (permissionError as Error & { code?: string }).code = 'permission-denied';
    hoisted.state.downloadErrorByBucketAndPath.set('quantified-self-io:users/u1/events/e1/original.fit', permissionError as Error & { code?: unknown });

    await expect(mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('should clear generated merge description even without setDescription helper', async () => {
    hoisted.mockMergeEvents.mockImplementationOnce((events: any[]) => {
      const mergedEvent = hoisted.makeEvent({ description: 'A merge of 2 or more activities auto generated' });
      delete (mergedEvent as any).setDescription;
      mergedEvent.clearActivities();
      mergedEvent.addActivities(events.flatMap((event) => event.getActivities()));
      return mergedEvent;
    });

    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);

    const mergedEvent = hoisted.mockWriteAllEventData.mock.calls[0][1] as { description?: string };
    expect(mergedEvent.description).toBe('');
  });

  it('should assign activities property when source event lacks addActivities API', async () => {
    const sourceEvent = hoisted.makeEvent({ description: 'Legacy source event' });
    delete (sourceEvent as any).addActivities;
    delete (sourceEvent as any).clearActivities;
    hoisted.mockEventImporterJSON.getEventFromJSON.mockImplementationOnce(() => sourceEvent);

    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);

    expect(Array.isArray((sourceEvent as any).activities)).toBe(true);
    expect((sourceEvent as any).activities.length).toBeGreaterThan(0);
  });

  it('should exercise writer adapters for firestore and storage writes', async () => {
    hoisted.state.exerciseWriterAdaptersOnce = true;

    await mergeEvents({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any);

    expect(hoisted.mockSetEventDocumentIfUserActive).toHaveBeenCalledWith(
      'u1',
      'merge_event_writer:users/u1/events/adapter-probe',
      expect.anything(),
      { probe: true },
    );
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({ probe: true }, undefined);
    expect(hoisted.mockAssertEventWriteUserActive).toHaveBeenCalledWith(
      'u1',
      'merge_event_original_file_upload:users/probe/events/adapter-probe/original.fit',
    );
    expect(hoisted.mockStorageSave).toHaveBeenCalled();
  });
});
