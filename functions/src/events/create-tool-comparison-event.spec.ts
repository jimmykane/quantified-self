import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Response } from 'express';
import type { Request } from 'firebase-functions/v2/https';
import { USAGE_LIMITS } from '../../../shared/limits';
import {
  TOOL_COMPARISON_EVENT_ID_HEADER,
  buildToolComparisonContentHashParts,
  buildToolComparisonEventIDHashParts,
  getToolComparisonBaseExtension,
} from '../../../shared/tool-comparison-id';

const hoisted = vi.hoisted(() => {
  const capturedOnRequestOptions = { value: undefined as unknown };
  const mockOnRequest = vi.fn((options: unknown, handler: unknown) => {
    capturedOnRequestOptions.value = options;
    return handler;
  });
  const mockVerifyIdToken = vi.fn();
  const mockVerifyAppCheckToken = vi.fn();
  const mockEventsCountGet = vi.fn();
  const mockActivitiesCountGet = vi.fn();
  const mockActivitiesQueryGet = vi.fn();
  const mockEventDocGet = vi.fn();
  const mockProcessingDocGet = vi.fn();
  const mockDocSet = vi.fn();
  const mockRecursiveDelete = vi.fn();
  const mockStorageSave = vi.fn();
  const mockWriteAllEventData = vi.fn();
  const capturedFirestoreAdapter = { value: undefined as unknown };
  const capturedStorageAdapter = { value: undefined as unknown };
  const mockGenerateActivityID = vi.fn();
  const mockGetUserDeletionGuardState = vi.fn();
  const mockSetEventDocumentIfUserActive = vi.fn();
  const mockAssertEventWriteUserActive = vi.fn();
  const mockHasProAccess = vi.fn();
  const mockHasBasicAccess = vi.fn();
  const mockEnforceAppCheckFlag = { value: true };
  const mockFITImporter = { getFromArrayBuffer: vi.fn() };
  const mockGPXImporter = { getFromString: vi.fn() };
  const mockTCXImporter = { getFromXML: vi.fn() };
  const mockMergeEvents = vi.fn();
  const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
  const mockSportsLibVersionToCode = vi.fn(() => 9001004);

  return {
    capturedOnRequestOptions,
    mockOnRequest,
    mockVerifyIdToken,
    mockVerifyAppCheckToken,
    mockEventsCountGet,
    mockActivitiesCountGet,
    mockActivitiesQueryGet,
    mockEventDocGet,
    mockProcessingDocGet,
    mockDocSet,
    mockRecursiveDelete,
    mockStorageSave,
    mockWriteAllEventData,
    capturedFirestoreAdapter,
    capturedStorageAdapter,
    mockGenerateActivityID,
    mockGetUserDeletionGuardState,
    mockSetEventDocumentIfUserActive,
    mockAssertEventWriteUserActive,
    mockHasProAccess,
    mockHasBasicAccess,
    mockEnforceAppCheckFlag,
    mockFITImporter,
    mockGPXImporter,
    mockTCXImporter,
    mockMergeEvents,
    mockServerTimestamp,
    mockSportsLibVersionToCode,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onRequest: hoisted.mockOnRequest,
}));

vi.mock('firebase-admin', () => {
  const firestoreFn = vi.fn(() => ({
    collection: (path: string) => {
      if (path === 'users') {
        return {
          doc: (id?: string) => {
            if (!id) {
              return { id: 'comparison-event-id' };
            }
            return {
              collection: (name: string) => {
                if (name === 'events') {
                  return {
                    count: () => ({ get: hoisted.mockEventsCountGet }),
                  };
                }
                if (name === 'activities') {
                  return {
                    where: () => ({
                      count: () => ({ get: hoisted.mockActivitiesCountGet }),
                      get: hoisted.mockActivitiesQueryGet,
                    }),
                  };
                }
                return {};
              },
            };
          },
        };
      }
      if (path === 'tmp') {
        return { doc: () => ({ id: 'tmp-generated-id' }) };
      }
      return { doc: () => ({}) };
    },
    doc: (path: string) => ({
      set: hoisted.mockDocSet,
      get: path.endsWith('/metaData/processing')
        ? hoisted.mockProcessingDocGet
        : hoisted.mockEventDocGet,
    }),
    recursiveDelete: hoisted.mockRecursiveDelete,
  }));

  return {
    auth: () => ({
      verifyIdToken: hoisted.mockVerifyIdToken,
    }),
    appCheck: () => ({
      verifyToken: hoisted.mockVerifyAppCheckToken,
    }),
    firestore: firestoreFn,
    storage: () => ({
      bucket: () => ({
        name: 'test-bucket',
        file: () => ({
          save: hoisted.mockStorageSave,
        }),
      }),
    }),
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: hoisted.mockServerTimestamp,
  },
}));

vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  get ENFORCE_APP_CHECK() {
    return hoisted.mockEnforceAppCheckFlag.value;
  },
  assertEventWriteUserActive: (...args: unknown[]) => hoisted.mockAssertEventWriteUserActive(...args),
  hasProAccess: (...args: unknown[]) => hoisted.mockHasProAccess(...args),
  hasBasicAccess: (...args: unknown[]) => hoisted.mockHasBasicAccess(...args),
  setEventDocumentIfUserActive: (...args: unknown[]) => hoisted.mockSetEventDocumentIfUserActive(...args),
}));

vi.mock('../shared/event-writer', () => ({
  EventWriter: vi.fn((firestoreAdapter: unknown, storageAdapter: unknown) => {
    hoisted.capturedFirestoreAdapter.value = firestoreAdapter;
    hoisted.capturedStorageAdapter.value = storageAdapter;
    return {
      writeAllEventData: (...args: unknown[]) => hoisted.mockWriteAllEventData(...args),
    };
  }),
}));

vi.mock('../shared/id-generator', () => ({
  generateActivityID: (...args: unknown[]) => hoisted.mockGenerateActivityID(...args),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: (...args: unknown[]) => hoisted.mockGetUserDeletionGuardState(...args),
}));

vi.mock('@sports-alliance/sports-lib', () => ({
  EventImporterFIT: hoisted.mockFITImporter,
  EventImporterGPX: hoisted.mockGPXImporter,
  EventImporterTCX: hoisted.mockTCXImporter,
  EventUtilities: {
    mergeEvents: (...args: unknown[]) => hoisted.mockMergeEvents(...args),
  },
  ActivityParsingOptions: class ActivityParsingOptions {
    constructor(_options: unknown) {}
  },
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
  sportsLibVersionToCode: (...args: unknown[]) => hoisted.mockSportsLibVersionToCode(...args),
}));

vi.mock('../../../shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: {
    createToolComparisonEvent: { name: 'createToolComparisonEvent', region: 'europe-west2' },
  },
}));

vi.mock('../shared/activity-processing-config', async () => {
  const actual = await vi.importActual<typeof import('../shared/activity-processing-config')>(
    '../shared/activity-processing-config',
  );
  return {
    ...actual,
    MAX_ACTIVITY_DECOMPRESSED_BYTES: 64,
    MAX_ACTIVITY_DECOMPRESSED_BYTES_LABEL: '64B',
  };
});

import { createToolComparisonEvent } from './create-tool-comparison-event';

type ComparisonRequestDouble = Pick<Request, 'method' | 'rawBody' | 'header'>;
type ComparisonResponseDouble = Pick<Response, 'status' | 'json'>;
type MockComparisonResponse = ComparisonResponseDouble & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

interface TestFile {
  bytes: Buffer;
  extension?: string;
  originalFilename?: string;
}

function makeActivity(label: string, initialActivityID: string | null = null) {
  let activityID: string | null = initialActivityID;
  const activity: any = {
    creator: { name: label },
    getID: vi.fn(() => activityID),
    setID: vi.fn((id: string) => {
      activityID = id;
      return activity;
    }),
  };
  return activity;
}

function makeParsedEvent(label: string, activities = [makeActivity(label)]) {
  let eventID = '';
  const event: any = {
    startDate: new Date('2026-01-10T10:00:00.000Z'),
    name: '',
    description: 'A merge of 2 or more activities',
    getID: vi.fn(() => eventID),
    setID: vi.fn((id: string) => {
      eventID = id;
      return event;
    }),
    getActivities: vi.fn(() => activities),
    setDescription: vi.fn((description: string) => {
      event.description = description;
      return event;
    }),
  };
  return event;
}

function makeMergedEvent(sourceEvents: any[]) {
  return makeParsedEvent(
    'merged',
    sourceEvents.flatMap((event) => event.getActivities()),
  );
}

function makeOriginalFileMetadata(count: number) {
  return Array.from({ length: count }, (_value, index) => ({
    path: `users/user-1/events/event-1/original_${index}.fit`,
    bucket: 'test-bucket',
    startDate: new Date('2026-01-10T10:00:00.000Z'),
    originalFilename: `source-${index}.fit`,
  }));
}

function makeRequest(overrides?: {
  method?: string;
  files?: TestFile[];
  headers?: Record<string, string | undefined>;
  rawBody?: Buffer;
}): ComparisonRequestDouble {
  const files = overrides?.files ?? [
    { bytes: Buffer.from([0x01, 0x02]), extension: 'fit', originalFilename: 'ref.fit' },
    { bytes: Buffer.from('<gpx></gpx>'), extension: 'gpx', originalFilename: 'test.gpx' },
  ];
  const rawBody = overrides?.rawBody ?? Buffer.concat(files.map(file => file.bytes));
  const manifest = files.map(file => ({
    originalFilename: file.originalFilename,
    extension: file.extension,
    byteLength: file.bytes.length,
  }));
  const mergedHeaders: Record<string, string | undefined> = {
    Authorization: 'Bearer token',
    'X-Firebase-AppCheck': 'app-check',
    'X-Tool-Comparison-Files-Encoded': encodeURIComponent(JSON.stringify(manifest)),
    ...(overrides?.headers || {}),
  };
  const headers = Object.fromEntries(
    Object.entries(mergedHeaders).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    method: overrides?.method || 'POST',
    rawBody,
    header: (name: string) => headers[name.toLowerCase()],
  };
}

function makeResponse(): MockComparisonResponse {
  const json = vi.fn();
  const response = {
    json,
    status: vi.fn(),
  } as MockComparisonResponse;
  response.status.mockImplementation(() => response);
  return response;
}

function makeNamedError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function sha256Hex(parts: ReadonlyArray<string | Buffer>): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest('hex');
}

function hasGzipMagic(data: Buffer): boolean {
  return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
}

function resolveExtensionForExpectedID(file: TestFile): string {
  if (file.extension) {
    return file.extension;
  }

  const parts = (file.originalFilename || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) {
    return '';
  }

  const last = parts[parts.length - 1];
  if (last === 'gz' && parts.length >= 3) {
    return `${parts[parts.length - 2]}.gz`;
  }
  return last;
}

function generateExpectedComparisonEventID(userID: string, files: TestFile[]): string {
  const contentHashes = files.map((file) => {
    const extension = resolveExtensionForExpectedID(file);
    const baseExtension = getToolComparisonBaseExtension(extension);
    const payload = extension.toLowerCase().endsWith('.gz') || hasGzipMagic(file.bytes)
      ? gunzipSync(file.bytes)
      : file.bytes;
    return sha256Hex(buildToolComparisonContentHashParts(baseExtension, payload));
  });

  return sha256Hex(buildToolComparisonEventIDHashParts(userID, contentHashes));
}

async function invokeCreateToolComparisonEvent(
  request: ComparisonRequestDouble,
  response: ComparisonResponseDouble,
): Promise<void> {
  await createToolComparisonEvent(request as Request, response as Response);
}

describe('createToolComparisonEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    hoisted.mockVerifyAppCheckToken.mockResolvedValue({ appId: 'app-id' });
    hoisted.mockEventsCountGet.mockResolvedValue({ data: () => ({ count: 0 }) });
    hoisted.mockActivitiesCountGet.mockResolvedValue({ data: () => ({ count: 2 }) });
    hoisted.mockActivitiesQueryGet.mockResolvedValue({ docs: [] });
    hoisted.mockEventDocGet.mockResolvedValue({ exists: false, data: () => undefined });
    hoisted.mockProcessingDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
    hoisted.mockWriteAllEventData.mockResolvedValue(undefined);
    hoisted.capturedFirestoreAdapter.value = undefined;
    hoisted.capturedStorageAdapter.value = undefined;
    hoisted.mockDocSet.mockResolvedValue(undefined);
    hoisted.mockRecursiveDelete.mockResolvedValue(undefined);
    hoisted.mockStorageSave.mockResolvedValue(undefined);
    hoisted.mockGenerateActivityID.mockImplementation(async (_eventID: string, index: number) => `activity-${index}`);
    hoisted.mockGetUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    hoisted.mockSetEventDocumentIfUserActive.mockImplementation(async (_userID, _phase, _docRef, data, options) => {
      await hoisted.mockDocSet(data, options);
    });
    hoisted.mockAssertEventWriteUserActive.mockResolvedValue(undefined);
    hoisted.mockHasProAccess.mockResolvedValue(false);
    hoisted.mockHasBasicAccess.mockResolvedValue(false);
    hoisted.mockEnforceAppCheckFlag.value = true;

    hoisted.mockFITImporter.getFromArrayBuffer.mockImplementation(async () => makeParsedEvent('fit'));
    hoisted.mockGPXImporter.getFromString.mockImplementation(async () => makeParsedEvent('gpx'));
    hoisted.mockTCXImporter.getFromXML.mockImplementation(async () => makeParsedEvent('tcx'));
    hoisted.mockMergeEvents.mockImplementation((events: any[]) => makeMergedEvent(events));
  });

  it('registers with activity processing runtime limits', () => {
    expect(hoisted.capturedOnRequestOptions.value).toEqual(expect.objectContaining({
      region: 'europe-west2',
      memory: '4GiB',
      cpu: 2,
      concurrency: 1,
      timeoutSeconds: 3600,
      maxInstances: 20,
    }));
  });

  it('rejects non-POST methods', async () => {
    const response = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({ method: 'GET' }), response);

    expect(response.status).toHaveBeenCalledWith(405);
  });

  it('rejects unauthenticated and missing App Check requests', async () => {
    const missingAuthResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      headers: { Authorization: undefined },
    }), missingAuthResponse);

    expect(missingAuthResponse.status).toHaveBeenCalledWith(401);

    const missingAppCheckResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      headers: { 'X-Firebase-AppCheck': undefined },
    }), missingAppCheckResponse);

    expect(missingAppCheckResponse.status).toHaveBeenCalledWith(401);
  });

  it('allows missing App Check when enforcement is disabled', async () => {
    hoisted.mockEnforceAppCheckFlag.value = false;
    const response = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      headers: { 'X-Firebase-AppCheck': undefined },
    }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockVerifyAppCheckToken).not.toHaveBeenCalled();
  });

  it('rejects comparison writes while the user is missing or being deleted', async () => {
    hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
      userExists: false,
      deletionInProgress: true,
      shouldSkip: true,
    });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ error: 'Account deletion is in progress. Please sign in again.' });
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('returns a retryable failure when the deletion guard cannot be read', async () => {
    hoisted.mockGetUserDeletionGuardState.mockRejectedValueOnce(new Error('guard unavailable'));
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ error: 'Could not verify account state. Please try again shortly.' });
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('rechecks account deletion state before persisting a parsed comparison', async () => {
    hoisted.mockGetUserDeletionGuardState
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: true,
        shouldSkip: true,
      });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it('passes deletion-guarded Firestore and Storage adapters into EventWriter', async () => {
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    const firestoreAdapter = hoisted.capturedFirestoreAdapter.value as {
      setDoc: (path: string[], data: unknown) => Promise<void>;
    };
    const storageAdapter = hoisted.capturedStorageAdapter.value as {
      uploadFile: (path: string, data: unknown) => Promise<void>;
    };

    await firestoreAdapter.setDoc(['users', 'user-1', 'events', 'event-1'], { name: 'guarded event' });
    await storageAdapter.uploadFile('users/user-1/events/event-1/original.fit', Buffer.from([1]));

    expect(hoisted.mockSetEventDocumentIfUserActive).toHaveBeenCalledWith(
      'user-1',
      'tool_comparison_writer:users/user-1/events/event-1',
      expect.anything(),
      { name: 'guarded event' },
    );
    expect(hoisted.mockAssertEventWriteUserActive).toHaveBeenCalledWith(
      'user-1',
      'tool_comparison_original_file_upload:users/user-1/events/event-1/original.fit',
    );
    expect(hoisted.mockStorageSave).toHaveBeenCalledWith(Buffer.from([1]));
  });

  it('returns a conflict when deletion starts inside EventWriter document persistence', async () => {
    hoisted.mockWriteAllEventData.mockImplementationOnce(async () => {
      const firestoreAdapter = hoisted.capturedFirestoreAdapter.value as {
        setDoc: (path: string[], data: unknown) => Promise<void>;
      };
      hoisted.mockSetEventDocumentIfUserActive.mockRejectedValueOnce(
        makeNamedError('EventWriteSkippedForDeletedUserError'),
      );
      await firestoreAdapter.setDoc(['users', 'user-1', 'events', 'event-1'], { name: 'blocked event' });
    });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ error: 'Account deletion is in progress. Please sign in again.' });
    expect(hoisted.mockSetEventDocumentIfUserActive).toHaveBeenCalledWith(
      'user-1',
      'tool_comparison_writer:users/user-1/events/event-1',
      expect.anything(),
      { name: 'blocked event' },
    );
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it('returns a retryable failure when guarded metadata cannot read deletion state', async () => {
    hoisted.mockSetEventDocumentIfUserActive.mockRejectedValueOnce(
      makeNamedError('UserDeletionGuardReadError'),
    );
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ error: 'Could not verify account state. Please try again shortly.' });
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
  });

  it('validates the file manifest and supported extensions', async () => {
    const missingManifestResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      headers: { 'X-Tool-Comparison-Files-Encoded': undefined },
    }), missingManifestResponse);
    expect(missingManifestResponse.status).toHaveBeenCalledWith(400);

    const unsupportedExtensionResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      files: [
        { bytes: Buffer.from([0x01]), extension: 'fit', originalFilename: 'ref.fit' },
        { bytes: Buffer.from([0x02]), extension: 'json', originalFilename: 'test.json' },
      ],
    }), unsupportedExtensionResponse);
    expect(unsupportedExtensionResponse.status).toHaveBeenCalledWith(400);
    expect(unsupportedExtensionResponse.json).toHaveBeenCalledWith({ error: 'Unsupported file extension: json. Supported: fit, gpx, tcx.' });

    const mismatchResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      rawBody: Buffer.from([0x01]),
    }), mismatchResponse);
    expect(mismatchResponse.status).toHaveBeenCalledWith(400);
    expect(mismatchResponse.json).toHaveBeenCalledWith({ error: 'File manifest byte lengths do not match request payload.' });

    const stringByteLengthManifest = [
      { originalFilename: 'ref.fit', extension: 'fit', byteLength: '2' },
      { originalFilename: 'test.gpx', extension: 'gpx', byteLength: 11 },
    ];
    const stringByteLengthResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      rawBody: Buffer.concat([Buffer.from([0x01, 0x02]), Buffer.from('<gpx></gpx>')]),
      headers: {
        'X-Tool-Comparison-Files-Encoded': encodeURIComponent(JSON.stringify(stringByteLengthManifest)),
      },
    }), stringByteLengthResponse);
    expect(stringByteLengthResponse.status).toHaveBeenCalledWith(400);
    expect(stringByteLengthResponse.json).toHaveBeenCalledWith({ error: 'File 1 has an invalid byte length.' });
  });

  it('rejects oversized encoded title headers before parsing files', async () => {
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({
      headers: {
        'X-Tool-Comparison-Title-Encoded': 'a'.repeat(1025),
      },
    }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Encoded request header is too large.' });
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('infers extensions from filenames and accepts lowercase request headers', async () => {
    const files = [
      { bytes: Buffer.from([0x01, 0x02]), originalFilename: 'ref.fit' },
      { bytes: Buffer.from('<TrainingCenterDatabase/>'), originalFilename: 'test.tcx' },
    ];
    const manifest = files.map(file => ({
      originalFilename: file.originalFilename,
      byteLength: file.bytes.length,
    }));
    const headers = {
      authorization: 'Bearer token',
      'x-firebase-appcheck': 'app-check',
      'x-tool-comparison-files-encoded': encodeURIComponent(JSON.stringify(manifest)),
    };
    const response = makeResponse();

    await invokeCreateToolComparisonEvent({
      method: 'POST',
      rawBody: Buffer.concat(files.map(file => file.bytes)),
      header: (name: string) => headers[name.toLowerCase() as keyof typeof headers],
    }, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockTCXImporter.getFromXML).toHaveBeenCalledTimes(1);
  });

  it('enforces free and basic upload limits before parsing files', async () => {
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: USAGE_LIMITS.free }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('enforces upload limits before decompressing or hashing gzip comparison files', async () => {
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: USAGE_LIMITS.free }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({
      files: [
        { bytes: gzipSync(Buffer.alloc(40, 1)), extension: 'fit.gz', originalFilename: 'ref.fit.gz' },
        { bytes: gzipSync(Buffer.alloc(40, 2)), extension: 'gpx.gz', originalFilename: 'test.gpx.gz' },
      ],
    }), response);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      error: `Upload limit reached for your tier. You have ${USAGE_LIMITS.free} events. Limit is ${USAGE_LIMITS.free}.`,
    });
    expect(hoisted.mockEventDocGet).not.toHaveBeenCalled();
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('treats pro users as unlimited', async () => {
    hoisted.mockHasProAccess.mockResolvedValueOnce(true);
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 250 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadLimit: null,
      uploadCountAfterWrite: 251,
    }));
  });

  it('returns existing comparisons without rewriting saved benchmark reports', async () => {
    const files = [
      { bytes: Buffer.from([0x01, 0x02]), extension: 'fit', originalFilename: 'ref.fit' },
      { bytes: Buffer.from('<gpx></gpx>'), extension: 'gpx', originalFilename: 'test.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        benchmarkStatus: 'draft',
        originalFiles: makeOriginalFileMetadata(2),
        hasBenchmark: true,
        benchmarkResults: {
          'activity-0__activity-1': { score: 92 },
        },
      }),
    });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: USAGE_LIMITS.free }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({
      files,
      headers: {
        [TOOL_COMPARISON_EVENT_ID_HEADER]: expectedEventID,
      },
    }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockMergeEvents).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      eventId: expectedEventID,
      sourceFilesCount: 2,
      activitiesCount: 2,
      uploadCountAfterWrite: USAGE_LIMITS.free,
      alreadyExists: true,
    }));
  });

  it('repairs at-limit existing comparisons when the hint matches uploaded files', async () => {
    const files = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 2 }) });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: USAGE_LIMITS.free }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({
      files,
      headers: {
        [TOOL_COMPARISON_EVENT_ID_HEADER]: expectedEventID,
      },
    }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      mergeType: 'benchmark',
      toolSource: 'tools/compare',
      sourceFilesCount: 2,
      activitiesCount: 2,
      benchmarkDevices: ['fit', 'gpx'],
      comparisonTitle: 'Benchmark comparison: Garmin vs Suunto',
      benchmarkStatus: 'draft',
    }, { merge: true });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      eventId: expectedEventID,
      uploadCountAfterWrite: USAGE_LIMITS.free,
      alreadyExists: true,
    }));
  });

  it('rejects at-limit repairs when the hinted comparison does not match uploaded files', async () => {
    const hintedFiles = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const uploadedFiles = [
      { bytes: Buffer.from([0x07, 0x08, 0x09]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk><name>different</name></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: USAGE_LIMITS.free }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({
      files: uploadedFiles,
      headers: {
        [TOOL_COMPARISON_EVENT_ID_HEADER]: generateExpectedComparisonEventID('user-1', hintedFiles),
      },
    }), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ error: 'Uploaded files do not match the existing comparison.' });
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it('uses the same deterministic comparison ID for the same files in a different order', async () => {
    const files = [
      { bytes: Buffer.from([0x08, 0x09, 0x0a]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    expect(generateExpectedComparisonEventID('user-1', [...files].reverse())).toBe(expectedEventID);
    hoisted.mockEventDocGet
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          isMerge: true,
          mergeType: 'benchmark',
          toolSource: 'tools/compare',
          comparisonTitle: 'Saved comparison',
          sourceFilesCount: 2,
          activitiesCount: 2,
          originalFiles: makeOriginalFileMetadata(2),
        }),
      });

    const firstResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({ files }), firstResponse);

    const secondResponse = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({ files: [...files].reverse() }), secondResponse);

    expect(firstResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      eventId: expectedEventID,
    }));
    expect(secondResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      eventId: expectedEventID,
      alreadyExists: true,
    }));
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
  });

  it('repairs partial existing benchmark comparisons left by metadata finalization failure', async () => {
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 3 }) });
    hoisted.mockFITImporter.getFromArrayBuffer.mockResolvedValueOnce(makeParsedEvent('fit', [
      makeActivity('fit-a'),
      makeActivity('fit-b'),
    ]));
    hoisted.mockGPXImporter.getFromString.mockResolvedValueOnce(makeParsedEvent('gpx', [
      makeActivity('gpx-a'),
    ]));
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockMergeEvents).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      mergeType: 'benchmark',
      toolSource: 'tools/compare',
      sourceFilesCount: 2,
      activitiesCount: 3,
      benchmarkDevices: ['fit-a', 'fit-b', 'gpx-a'],
      comparisonTitle: 'Benchmark comparison: ref vs test',
      benchmarkStatus: 'draft',
    }, { merge: true });
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      sportsLibVersion: expect.any(String),
      sportsLibVersionCode: 9001004,
      processedAt: 'SERVER_TIMESTAMP',
    }, { merge: true });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      sourceFilesCount: 2,
      activitiesCount: 3,
      alreadyExists: true,
    }));
  });

  it('repairs stale existing comparison counts before returning an existing benchmark', async () => {
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 1,
        activitiesCount: 1,
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 2 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      sourceFilesCount: 2,
      activitiesCount: 2,
      benchmarkDevices: ['fit', 'gpx'],
      benchmarkStatus: 'draft',
    }, { merge: true });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      sourceFilesCount: 2,
      activitiesCount: 2,
      alreadyExists: true,
    }));
  });

  it('rewrites incomplete existing comparisons when too few linked activities were written', async () => {
    const files = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 1 }) });
    const existingActivityRefs = [
      { path: 'users/user-1/activities/activity-0' },
    ];
    hoisted.mockActivitiesQueryGet.mockResolvedValueOnce({
      docs: existingActivityRefs.map(ref => ({ ref })),
    });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 12 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockRecursiveDelete).toHaveBeenCalledWith(existingActivityRefs[0]);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      isMerge: true,
      mergeType: 'benchmark',
      toolSource: 'tools/compare',
      sourceFilesCount: 2,
      activitiesCount: 2,
      benchmarkDevices: ['fit', 'gpx'],
      comparisonTitle: 'Benchmark comparison: Garmin vs Suunto',
      benchmarkStatus: 'draft',
    }, { merge: true });
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 2,
      activitiesCount: 2,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 12,
      alreadyExists: false,
    });
  });

  it('does not delete or rewrite linked activities when deletion starts before rewrite cleanup', async () => {
    const files = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 1 }) });
    hoisted.mockAssertEventWriteUserActive.mockRejectedValueOnce(
      makeNamedError('EventWriteSkippedForDeletedUserError'),
    );
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ error: 'Account deletion is in progress. Please sign in again.' });
    expect(hoisted.mockAssertEventWriteUserActive).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('tool_comparison_rewrite_activity_cleanup:'),
    );
    expect(hoisted.mockActivitiesQueryGet).not.toHaveBeenCalled();
    expect(hoisted.mockRecursiveDelete).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('rewrites existing comparisons when linked activities match source files but not expected merged activities', async () => {
    const files = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 2 }) });
    hoisted.mockFITImporter.getFromArrayBuffer.mockResolvedValueOnce(makeParsedEvent('fit', [
      makeActivity('fit-a'),
      makeActivity('fit-b'),
      makeActivity('fit-c'),
      makeActivity('fit-d'),
      makeActivity('fit-e'),
    ]));
    hoisted.mockGPXImporter.getFromString.mockResolvedValueOnce(makeParsedEvent('gpx', [
      makeActivity('gpx-a'),
      makeActivity('gpx-b'),
      makeActivity('gpx-c'),
      makeActivity('gpx-d'),
      makeActivity('gpx-e'),
    ]));
    const existingActivityRefs = [
      { path: 'users/user-1/activities/activity-0' },
      { path: 'users/user-1/activities/activity-1' },
    ];
    hoisted.mockActivitiesQueryGet.mockResolvedValueOnce({
      docs: existingActivityRefs.map(ref => ({ ref })),
    });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 12 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockRecursiveDelete).toHaveBeenCalledWith(existingActivityRefs[0]);
    expect(hoisted.mockRecursiveDelete).toHaveBeenCalledWith(existingActivityRefs[1]);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      isMerge: true,
      mergeType: 'benchmark',
      toolSource: 'tools/compare',
      sourceFilesCount: 2,
      activitiesCount: 10,
      benchmarkDevices: [
        'fit-a',
        'fit-b',
        'fit-c',
        'fit-d',
        'fit-e',
        'gpx-a',
        'gpx-b',
        'gpx-c',
        'gpx-d',
        'gpx-e',
      ],
      comparisonTitle: 'Benchmark comparison: Garmin vs Suunto',
      benchmarkStatus: 'draft',
    }, { merge: true });
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 2,
      activitiesCount: 10,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 12,
      alreadyExists: false,
    });
  });

  it('does not trust saved benchmark results without the expected activity count marker', async () => {
    const files = [
      { bytes: Buffer.from([0x24, 0x25, 0x26]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk><name>Suunto</name></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        originalFiles: makeOriginalFileMetadata(2),
        hasBenchmark: true,
        benchmarkResults: {
          'activity-0__activity-1': { score: 92 },
        },
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 2 }) });
    hoisted.mockFITImporter.getFromArrayBuffer.mockResolvedValueOnce(makeParsedEvent('fit', [
      makeActivity('fit-a'),
      makeActivity('fit-b'),
      makeActivity('fit-c'),
    ]));
    hoisted.mockGPXImporter.getFromString.mockResolvedValueOnce(makeParsedEvent('gpx', [
      makeActivity('gpx-a'),
      makeActivity('gpx-b'),
      makeActivity('gpx-c'),
    ]));
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 12 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 2,
      activitiesCount: 6,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 12,
      alreadyExists: false,
    });
  });

  it('rewrites finalized comparisons when linked activities are below the stored expected activity count', async () => {
    const files = [
      { bytes: Buffer.from([0x14, 0x15, 0x16]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk><name>Suunto</name></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 10,
        benchmarkStatus: 'draft',
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 2 }) });
    hoisted.mockFITImporter.getFromArrayBuffer.mockResolvedValueOnce(makeParsedEvent('fit', [
      makeActivity('fit-a'),
      makeActivity('fit-b'),
      makeActivity('fit-c'),
      makeActivity('fit-d'),
      makeActivity('fit-e'),
    ]));
    hoisted.mockGPXImporter.getFromString.mockResolvedValueOnce(makeParsedEvent('gpx', [
      makeActivity('gpx-a'),
      makeActivity('gpx-b'),
      makeActivity('gpx-c'),
      makeActivity('gpx-d'),
      makeActivity('gpx-e'),
    ]));
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 12 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 2,
      activitiesCount: 10,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 12,
      alreadyExists: false,
    });
  });

  it('rewrites existing comparisons when original source file metadata is incomplete', async () => {
    const files = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        originalFiles: [
          makeOriginalFileMetadata(1)[0],
          { bucket: 'test-bucket', originalFilename: 'missing-path.gpx' },
        ],
      }),
    });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 12 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 2,
      activitiesCount: 2,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 12,
      alreadyExists: false,
    });
  });

  it('rewrites existing comparisons when original source file start dates are missing', async () => {
    const files = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        originalFiles: [
          makeOriginalFileMetadata(1)[0],
          { path: 'users/user-1/events/event-1/original_1.gpx', bucket: 'test-bucket', originalFilename: 'missing-date.gpx' },
        ],
      }),
    });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 12 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 2,
      activitiesCount: 2,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 12,
      alreadyExists: false,
    });
  });

  it('rewrites existing comparisons when linked activities are fewer than source files', async () => {
    const files = [
      { bytes: Buffer.from([0x04, 0x05, 0x06]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx><trk></trk></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
      { bytes: Buffer.from('<TrainingCenterDatabase/>'), extension: 'tcx', originalFilename: 'Polar.tcx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 3,
        activitiesCount: 2,
        originalFiles: makeOriginalFileMetadata(3),
      }),
    });
    hoisted.mockActivitiesCountGet.mockResolvedValueOnce({ data: () => ({ count: 2 }) });
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 12 }) });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({ files }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockTCXImporter.getFromXML).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 3,
      activitiesCount: 3,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 12,
      alreadyExists: false,
    });
  });

  it('repairs missing processing metadata for otherwise complete existing comparisons', async () => {
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        isMerge: true,
        mergeType: 'benchmark',
        toolSource: 'tools/compare',
        comparisonTitle: 'Saved comparison',
        sourceFilesCount: 2,
        activitiesCount: 2,
        benchmarkStatus: 'draft',
        originalFiles: makeOriginalFileMetadata(2),
      }),
    });
    hoisted.mockProcessingDocGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).toHaveBeenCalledTimes(1);
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      sportsLibVersion: expect.any(String),
      sportsLibVersionCode: 9001004,
      processedAt: 'SERVER_TIMESTAMP',
    }, { merge: true });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      sourceFilesCount: 2,
      activitiesCount: 2,
      alreadyExists: true,
    }));
  });

  it('rejects deterministic ID conflicts with non-benchmark events', async () => {
    hoisted.mockEventDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        mergeType: 'multi',
        sourceFilesCount: 2,
        activitiesCount: 2,
      }),
    });
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ error: 'A different event already exists for this comparison.' });
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it('rejects duplicate file content before writing the comparison event', async () => {
    const response = makeResponse();
    await invokeCreateToolComparisonEvent(makeRequest({
      files: [
        { bytes: Buffer.from([0x01, 0x02]), extension: 'fit', originalFilename: 'ref.fit' },
        { bytes: Buffer.from([0x01, 0x02]), extension: 'fit', originalFilename: 'test.fit' },
      ],
    }), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('rejects duplicate content when one payload is gzip-wrapped', async () => {
    const sharedPayload = Buffer.from([0x0e, 0x10, 0x01]);
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({
      files: [
        { bytes: sharedPayload, extension: 'fit', originalFilename: 'ref.fit' },
        { bytes: gzipSync(sharedPayload), extension: 'fit.gz', originalFilename: 'test.fit.gz' },
      ],
    }), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('rejects comparisons that exceed the combined decompressed payload limit', async () => {
    const response = makeResponse();

    await invokeCreateToolComparisonEvent(makeRequest({
      files: [
        { bytes: gzipSync(Buffer.alloc(40, 1)), extension: 'fit.gz', originalFilename: 'ref.fit.gz' },
        { bytes: gzipSync(Buffer.alloc(40, 2)), extension: 'gpx.gz', originalFilename: 'test.gpx.gz' },
      ],
    }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Combined files are too large after decompression. Maximum decompressed size is 64B.',
    });
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('creates one persisted benchmark merge event from multiple files', async () => {
    const response = makeResponse();
    const files = [
      { bytes: Buffer.from([0x01, 0x02, 0x03]), extension: 'fit', originalFilename: 'Garmin.fit' },
      { bytes: Buffer.from('<gpx></gpx>'), extension: 'gpx', originalFilename: 'Suunto.gpx' },
    ];
    const expectedEventID = generateExpectedComparisonEventID('user-1', files);
    hoisted.mockFITImporter.getFromArrayBuffer.mockResolvedValueOnce(makeParsedEvent('fit', [
      makeActivity('fit', 'source-fit-activity-id'),
    ]));
    hoisted.mockGPXImporter.getFromString.mockResolvedValueOnce(makeParsedEvent('gpx', [
      makeActivity('gpx', 'source-gpx-activity-id'),
    ]));

    await invokeCreateToolComparisonEvent(makeRequest({
      files,
      headers: {
        'X-Tool-Comparison-Title-Encoded': encodeURIComponent('Review test'),
      },
    }), response);

    expect(hoisted.mockMergeEvents).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGenerateActivityID).toHaveBeenCalledWith(expectedEventID, 0);
    expect(hoisted.mockGenerateActivityID).toHaveBeenCalledWith(expectedEventID, 1);

    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledTimes(1);
    const writeArgs = hoisted.mockWriteAllEventData.mock.calls[0];
    expect(writeArgs[0]).toBe('user-1');
    expect(writeArgs[1].getID()).toBe(expectedEventID);
    expect(writeArgs[1]).toMatchObject({
      name: 'Review test',
      isMerge: true,
      mergeType: 'benchmark',
      description: '',
    });
    expect(writeArgs[1].getActivities().map((activity: ReturnType<typeof makeActivity>) => activity.getID()))
      .toEqual(['activity-0', 'activity-1']);
    expect(writeArgs[2]).toHaveLength(2);
    expect(writeArgs[2][0]).toMatchObject({ extension: 'fit', originalFilename: 'Garmin.fit' });
    expect(writeArgs[2][1]).toMatchObject({ extension: 'gpx', originalFilename: 'Suunto.gpx' });

    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      isMerge: true,
      mergeType: 'benchmark',
      toolSource: 'tools/compare',
      sourceFilesCount: 2,
      activitiesCount: 2,
      benchmarkDevices: ['fit', 'gpx'],
      comparisonTitle: 'Review test',
      benchmarkStatus: 'draft',
    }, { merge: true });
    expect(hoisted.mockDocSet).toHaveBeenCalledWith({
      sportsLibVersion: expect.any(String),
      sportsLibVersionCode: 9001004,
      processedAt: 'SERVER_TIMESTAMP',
    }, { merge: true });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      eventId: expectedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: 2,
      activitiesCount: 2,
      uploadLimit: USAGE_LIMITS.free,
      uploadCountAfterWrite: 1,
      alreadyExists: false,
    });
  });
});
