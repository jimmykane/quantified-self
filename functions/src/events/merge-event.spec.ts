import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    eventCount: 0,
    eventDocs: new Map<string, Record<string, unknown>>(),
    activitiesByEventID: new Map<string, Array<{ id: string; data: Record<string, unknown> }>>(),
    fileBytesByPath: new Map<string, Buffer>(),
    missingFilePaths: new Set<string>(),
  };

  const mockHasProAccess = vi.fn();
  const mockHasBasicAccess = vi.fn();
  const mockDocSet = vi.fn();
  const mockWriteAllEventData = vi.fn();
  const mockSportsLibVersionToCode = vi.fn(() => 9001004);
  const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');

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
    mockDocSet,
    mockWriteAllEventData,
    mockSportsLibVersionToCode,
    mockServerTimestamp,
    mockEventImporterJSON,
    mockMergeEvents,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
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
            return { id: 'merged-event-id' };
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
        name: bucketName || 'quantified-self-io',
        file: (path: string) => ({
          download: async () => {
            if (hoisted.state.missingFilePaths.has(path)) {
              const error = new Error('No such object');
              (error as Error & { code?: number }).code = 404;
              throw error;
            }
            const bytes = hoisted.state.fileBytesByPath.get(path) || Buffer.from('default-file-content');
            return [bytes];
          },
          save: vi.fn(),
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
  enforceAppCheck: (request: { app?: unknown }) => {
    if (!request.app) {
      throw new Error('App Check verification failed.');
    }
  },
  hasProAccess: (...args: unknown[]) => hoisted.mockHasProAccess(...args),
  hasBasicAccess: (...args: unknown[]) => hoisted.mockHasBasicAccess(...args),
}));

vi.mock('../shared/event-writer', () => ({
  EventWriter: vi.fn(() => ({
    writeAllEventData: (...args: unknown[]) => hoisted.mockWriteAllEventData(...args),
  })),
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
  sportsLibVersionToCode: (...args: unknown[]) => hoisted.mockSportsLibVersionToCode(...args),
}));

vi.mock('../../../src/shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: {
    mergeEvent: { name: 'mergeEvent', region: 'europe-west2' },
  },
}));

import { mergeEvent } from './merge-event';

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

describe('mergeEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hoisted.state.eventCount = 0;
    hoisted.state.eventDocs.clear();
    hoisted.state.activitiesByEventID.clear();
    hoisted.state.fileBytesByPath.clear();
    hoisted.state.missingFilePaths.clear();

    hoisted.mockHasProAccess.mockResolvedValue(false);
    hoisted.mockHasBasicAccess.mockResolvedValue(false);
    hoisted.mockDocSet.mockResolvedValue(undefined);
    hoisted.mockWriteAllEventData.mockResolvedValue(undefined);

    seedTwoEvents();
  });

  it('should reject unauthenticated requests', async () => {
    await expect(mergeEvent({
      auth: null,
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('should reject requests without app check', async () => {
    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: undefined,
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toThrow('App Check verification failed.');
  });

  it('should validate payload', async () => {
    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e1'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: Array.from({ length: 11 }).map((_, index) => `e${index}`), mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'invalid' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('should enforce ownership by user-scoped event paths', async () => {
    hoisted.state.eventDocs.delete('users/u1/events/e2');

    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'not-found' });

    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('should enforce free/basic upload limits and bypass for pro/grace', async () => {
    hoisted.state.eventCount = 10;

    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'resource-exhausted' });

    hoisted.mockHasBasicAccess.mockResolvedValue(true);
    hoisted.state.eventCount = 100;
    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'resource-exhausted' });

    hoisted.mockHasProAccess.mockResolvedValue(true);
    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).resolves.toMatchObject({ eventId: 'merged-event-id' });
  });

  it('should fail whole merge when a source file is missing', async () => {
    hoisted.state.missingFilePaths.add('users/u1/events/e2/original.gpx.gz');

    await expect(mergeEvent({
      auth: { uid: 'u1' },
      app: { appId: 'app-id' },
      data: { eventIds: ['e1', 'e2'], mergeType: 'benchmark' },
    } as any)).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('should merge events and return normalized payload', async () => {
    const result = await mergeEvent({
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
      uploadLimit: 10,
      uploadCountAfterWrite: 1,
    });
  });
});
