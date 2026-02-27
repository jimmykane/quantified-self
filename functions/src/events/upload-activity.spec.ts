import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

const hoisted = vi.hoisted(() => {
  const capturedOnRequestOptions = { value: undefined as unknown };
  const mockOnRequest = vi.fn((options: unknown, handler: unknown) => {
    capturedOnRequestOptions.value = options;
    return handler;
  });
  const mockVerifyIdToken = vi.fn();
  const mockVerifyAppCheckToken = vi.fn();
  const mockEventsCountGet = vi.fn();
  const mockDocSet = vi.fn();
  const mockStorageSave = vi.fn();
  const mockWriteAllEventData = vi.fn();
  const mockGenerateEventID = vi.fn();
  const mockGenerateActivityID = vi.fn();
  const mockHasProAccess = vi.fn();
  const mockHasBasicAccess = vi.fn();
  const mockEnforceAppCheckFlag = { value: true };
  const mockFITImporter = { getFromArrayBuffer: vi.fn() };
  const mockGPXImporter = { getFromString: vi.fn() };
  const mockTCXImporter = { getFromXML: vi.fn() };
  const mockSuuntoJSONImporter = { getFromJSONString: vi.fn() };
  const mockSuuntoSMLImporter = { getFromXML: vi.fn(), getFromJSONString: vi.fn() };
  const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
  const mockSportsLibVersionToCode = vi.fn(() => 9001004);

  return {
    capturedOnRequestOptions,
    mockOnRequest,
    mockVerifyIdToken,
    mockVerifyAppCheckToken,
    mockEventsCountGet,
    mockDocSet,
    mockStorageSave,
    mockWriteAllEventData,
    mockGenerateEventID,
    mockGenerateActivityID,
    mockHasProAccess,
    mockHasBasicAccess,
    mockEnforceAppCheckFlag,
    mockFITImporter,
    mockGPXImporter,
    mockTCXImporter,
    mockSuuntoJSONImporter,
    mockSuuntoSMLImporter,
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
          doc: () => ({
            collection: (name: string) => {
              if (name === 'events') {
                return {
                  count: () => ({ get: hoisted.mockEventsCountGet }),
                };
              }
              return {};
            },
          }),
        };
      }
      if (path === 'tmp') {
        return { doc: () => ({ id: 'tmp-generated-id' }) };
      }
      return { doc: () => ({}) };
    },
    doc: (_path: string) => ({
      set: hoisted.mockDocSet,
    }),
  }));

  Object.assign(firestoreFn, {
    FieldValue: {
      serverTimestamp: hoisted.mockServerTimestamp,
    },
  });

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

vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  get ENFORCE_APP_CHECK() {
    return hoisted.mockEnforceAppCheckFlag.value;
  },
  hasProAccess: (...args: unknown[]) => hoisted.mockHasProAccess(...args),
  hasBasicAccess: (...args: unknown[]) => hoisted.mockHasBasicAccess(...args),
}));

vi.mock('../shared/event-writer', () => ({
  EventWriter: vi.fn(() => ({
    writeAllEventData: (...args: unknown[]) => hoisted.mockWriteAllEventData(...args),
  })),
}));

vi.mock('../shared/id-generator', () => ({
  generateEventID: (...args: unknown[]) => hoisted.mockGenerateEventID(...args),
  generateActivityID: (...args: unknown[]) => hoisted.mockGenerateActivityID(...args),
}));

vi.mock('@sports-alliance/sports-lib', () => ({
  EventImporterFIT: hoisted.mockFITImporter,
  EventImporterGPX: hoisted.mockGPXImporter,
  EventImporterTCX: hoisted.mockTCXImporter,
  EventImporterSuuntoJSON: hoisted.mockSuuntoJSONImporter,
  EventImporterSuuntoSML: hoisted.mockSuuntoSMLImporter,
  ActivityParsingOptions: class ActivityParsingOptions {
    constructor(_options: unknown) {}
  },
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
  sportsLibVersionToCode: (...args: unknown[]) => hoisted.mockSportsLibVersionToCode(...args),
}));

vi.mock('../../../src/shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: {
    uploadActivity: { name: 'uploadActivity', region: 'europe-west2' },
  },
}));

import { uploadActivity } from './upload-activity';

function makeRequest(overrides?: {
  method?: string;
  headers?: Record<string, string | undefined>;
  rawBody?: Buffer;
}) {
  const mergedHeaders: Record<string, string | undefined> = {
    'X-File-Extension': 'fit',
    ...(overrides?.headers || {}),
  };

  const headers = Object.fromEntries(
    Object.entries(mergedHeaders).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    method: overrides?.method || 'POST',
    rawBody: overrides?.rawBody ?? Buffer.from([0x01, 0x02, 0x03]),
    header: (name: string) => headers[name.toLowerCase()],
  };
}

function makeResponse() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

function makeParsedEvent() {
  const activity = { getID: vi.fn(() => null), setID: vi.fn() };
  return {
    startDate: new Date('2026-01-10T10:00:00.000Z'),
    name: '',
    setID: vi.fn(),
    getActivities: vi.fn(() => [activity]),
  };
}

function arrayBufferToBuffer(data: ArrayBuffer): Buffer {
  return Buffer.from(new Uint8Array(data));
}

describe('uploadActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hoisted.mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    hoisted.mockVerifyAppCheckToken.mockResolvedValue({ appId: 'app-id' });
    hoisted.mockEventsCountGet.mockResolvedValue({ data: () => ({ count: 0 }) });
    hoisted.mockWriteAllEventData.mockResolvedValue(undefined);
    hoisted.mockDocSet.mockResolvedValue(undefined);
    hoisted.mockStorageSave.mockResolvedValue(undefined);
    hoisted.mockGenerateEventID.mockResolvedValue('event-1');
    hoisted.mockGenerateActivityID.mockResolvedValue('activity-1');
    hoisted.mockHasProAccess.mockResolvedValue(false);
    hoisted.mockHasBasicAccess.mockResolvedValue(false);
    hoisted.mockEnforceAppCheckFlag.value = true;

    hoisted.mockFITImporter.getFromArrayBuffer.mockResolvedValue(makeParsedEvent());
    hoisted.mockGPXImporter.getFromString.mockResolvedValue(makeParsedEvent());
    hoisted.mockTCXImporter.getFromXML.mockResolvedValue(makeParsedEvent());
    hoisted.mockSuuntoJSONImporter.getFromJSONString.mockResolvedValue(makeParsedEvent());
    hoisted.mockSuuntoSMLImporter.getFromXML.mockResolvedValue(makeParsedEvent());
    hoisted.mockSuuntoSMLImporter.getFromJSONString.mockResolvedValue(makeParsedEvent());
  });

  it('should register with memory and concurrency limits to avoid upload OOM', () => {
    expect(hoisted.capturedOnRequestOptions.value).toEqual(expect.objectContaining({
      memory: '512MiB',
      concurrency: 1,
      timeoutSeconds: 540,
    }));
  });

  it('should reject non-POST methods', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({ method: 'GET' }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(405);
  });

  it('should reject missing auth header', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { 'X-Firebase-AppCheck': 'app-check' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('should reject empty bearer token', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer   ',
        'X-Firebase-AppCheck': 'app-check',
      },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'Missing Firebase ID token.' });
  });

  it('should reject invalid firebase auth tokens', async () => {
    hoisted.mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'));
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
      },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'Unauthenticated request.' });
  });

  it('should reject missing app check header', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('should reject invalid app check token', async () => {
    hoisted.mockVerifyAppCheckToken.mockRejectedValueOnce(new Error('invalid app check'));
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
      },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'Invalid App Check token.' });
  });

  it('should allow missing app check header when enforcement is disabled', async () => {
    hoisted.mockEnforceAppCheckFlag.value = false;
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockVerifyAppCheckToken).not.toHaveBeenCalled();
  });

  it('should reject unsupported extension', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'pdf',
      },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('should infer extension from filename when extension header is missing', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': undefined,
        'X-Original-Filename': 'run.fit',
      },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
  });

  it('should infer fit.gz from filename when extension header is missing', async () => {
    const response = makeResponse();
    const fitBytes = Buffer.from([0x0e, 0x10, 0x01, 0x02, 0x03]);
    const gzippedFit = gzipSync(fitBytes);

    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': undefined,
        'X-Original-Filename': 'run.fit.gz',
      },
      rawBody: gzippedFit,
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.objectContaining({
        extension: 'fit.gz',
        originalFilename: 'run.fit.gz',
      }),
    );
  });

  it('should normalize dotted uppercase extension headers', async () => {
    const response = makeResponse();
    const payload = gzipSync(Buffer.from('<gpx><trk/></gpx>'));

    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': '.GPX.GZ',
      },
      rawBody: payload,
    }) as any, response as any);

    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('should reject empty payload', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token', 'X-Firebase-AppCheck': 'app-check' },
      rawBody: Buffer.alloc(0),
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('should reject payloads larger than 10MB', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token', 'X-Firebase-AppCheck': 'app-check' },
      rawBody: Buffer.alloc((10 * 1024 * 1024) + 1),
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('should enforce free upload limits', async () => {
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 10 }) });
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token', 'X-Firebase-AppCheck': 'app-check' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(hoisted.mockWriteAllEventData).not.toHaveBeenCalled();
  });

  it('should allow basic users up to basic tier limit', async () => {
    hoisted.mockHasBasicAccess.mockResolvedValueOnce(true);
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 99 }) });

    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token', 'X-Firebase-AppCheck': 'app-check' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadLimit: 100,
      uploadCountAfterWrite: 100,
    }));
  });

  it('should treat pro users as unlimited', async () => {
    hoisted.mockHasProAccess.mockResolvedValueOnce(true);
    hoisted.mockEventsCountGet.mockResolvedValueOnce({ data: () => ({ count: 250 }) });

    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token', 'X-Firebase-AppCheck': 'app-check' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadLimit: null,
      uploadCountAfterWrite: 251,
    }));
  });

  it('should map FIT parser failures to 400', async () => {
    hoisted.mockFITImporter.getFromArrayBuffer.mockRejectedValueOnce(new Error('bad fit'));
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token', 'X-Firebase-AppCheck': 'app-check' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('should return 500 on persistence failures', async () => {
    hoisted.mockWriteAllEventData.mockRejectedValueOnce(new Error('write failed'));
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: { Authorization: 'Bearer token', 'X-Firebase-AppCheck': 'app-check' },
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('should persist parsed FIT and return response', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-Original-Filename': 'run.fit',
        'X-File-Extension': 'fit',
      },
      rawBody: Buffer.from([1, 2, 3, 4]),
    }) as any, response as any);

    expect(hoisted.mockGenerateEventID).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-01-10T10:00:00.000Z'),
      0,
    );
    expect(hoisted.mockGenerateActivityID).toHaveBeenCalledWith('event-1', 0);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.objectContaining({
        extension: 'fit',
        originalFilename: 'run.fit',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-1',
      activitiesCount: 1,
      uploadLimit: 10,
      uploadCountAfterWrite: 1,
    }));
  });

  it('should parse gzip GPX payload and persist compressed extension', async () => {
    const response = makeResponse();
    const payload = gzipSync(Buffer.from('<gpx><trk/></gpx>'));

    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'gpx.gz',
        'X-Original-Filename': 'morning.gpx',
      },
      rawBody: payload,
    }) as any, response as any);

    expect(hoisted.mockGPXImporter.getFromString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.objectContaining({
        extension: 'gpx.gz',
        originalFilename: 'morning.gpx',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('should parse TCX payloads through TCX importer', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'tcx',
      },
      rawBody: Buffer.from('<TrainingCenterDatabase></TrainingCenterDatabase>'),
    }) as any, response as any);

    expect(hoisted.mockTCXImporter.getFromXML).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('should parse Suunto JSON payloads without fallback when primary parser succeeds', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'json',
      },
      rawBody: Buffer.from('{"activity":"ok"}'),
    }) as any, response as any);

    expect(hoisted.mockSuuntoJSONImporter.getFromJSONString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockSuuntoSMLImporter.getFromJSONString).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('should parse SML payloads through SML importer', async () => {
    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'sml',
      },
      rawBody: Buffer.from('<sml><entry/></sml>'),
    }) as any, response as any);

    expect(hoisted.mockSuuntoSMLImporter.getFromXML).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('should decompress gzip FIT payload even when extension is fit (no .gz suffix)', async () => {
    const response = makeResponse();
    const fitBytes = Buffer.from([0x0e, 0x10, 0x01, 0x02, 0x03]);
    const gzippedFit = gzipSync(fitBytes);

    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'fit',
        'X-Original-Filename': 'run.fit',
      },
      rawBody: gzippedFit,
    }) as any, response as any);

    expect(hoisted.mockFITImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    const parsedPayload = hoisted.mockFITImporter.getFromArrayBuffer.mock.calls[0][0] as ArrayBuffer;
    expect(arrayBufferToBuffer(parsedPayload)).toEqual(fitBytes);
    expect(hoisted.mockWriteAllEventData).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.objectContaining({
        extension: 'fit.gz',
        originalFilename: 'run.fit',
      }),
    );
  });

  it('should return 400 when fit payload has gzip magic but is not valid gzip data', async () => {
    const response = makeResponse();
    const invalidGzipLikeFit = Buffer.from([
      0x1f, 0x8b, // gzip magic
      0x08, 0x00, 0x00, 0x00, 0x00, 0x00, // looks like gzip header start
      0xff, 0xff, 0x00, 0x01, // invalid/truncated payload
    ]);

    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'fit',
      },
      rawBody: invalidGzipLikeFit,
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Could not decompress uploaded payload.' });
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
  });

  it('should return 400 when gzip payload expands beyond decompression safety limit', async () => {
    const response = makeResponse();
    const compressedBomb = gzipSync(Buffer.alloc((150 * 1024 * 1024) + 1, 0x00));

    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'fit',
      },
      rawBody: compressedBomb,
    }) as any, response as any);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Could not decompress uploaded payload.' });
    expect(hoisted.mockFITImporter.getFromArrayBuffer).not.toHaveBeenCalled();
  });

  it('should fallback to SML parser when Suunto JSON parser fails', async () => {
    hoisted.mockSuuntoJSONImporter.getFromJSONString.mockRejectedValueOnce(new Error('bad json'));

    const response = makeResponse();
    await uploadActivity(makeRequest({
      headers: {
        Authorization: 'Bearer token',
        'X-Firebase-AppCheck': 'app-check',
        'X-File-Extension': 'json',
      },
      rawBody: Buffer.from('{"foo":"bar"}'),
    }) as any, response as any);

    expect(hoisted.mockSuuntoJSONImporter.getFromJSONString).toHaveBeenCalledTimes(1);
    expect(hoisted.mockSuuntoSMLImporter.getFromJSONString).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
  });
});
