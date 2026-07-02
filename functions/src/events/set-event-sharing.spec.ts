import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockEventGet = vi.fn();
  const mockEventUpdate = vi.fn();
  const mockDoc = vi.fn(() => ({
    get: mockEventGet,
    update: mockEventUpdate,
  }));
  const mockGetMetadata = vi.fn();
  const mockSetMetadata = vi.fn();
  const mockFile = vi.fn(() => ({
    getMetadata: mockGetMetadata,
    setMetadata: mockSetMetadata,
  }));
  const mockBucket = vi.fn(() => ({
    name: 'quantified-self-io',
    file: mockFile,
  }));
  const mockSanitizeEventFirestoreWritePayload = vi.fn((payload: unknown) => payload);
  const mockEnforceAppCheck = vi.fn();
  let onCallOptions: unknown = null;

  return {
    mockBucket,
    mockDoc,
    mockEnforceAppCheck,
    mockEventGet,
    mockEventUpdate,
    mockFile,
    mockGetMetadata,
    mockSanitizeEventFirestoreWritePayload,
    mockSetMetadata,
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

vi.mock('firebase-functions/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    doc: hoisted.mockDoc,
  }),
  storage: () => ({
    bucket: hoisted.mockBucket,
  }),
}));

vi.mock('../../../shared/firestore-write-sanitizer', () => ({
  sanitizeEventFirestoreWritePayload: (...args: unknown[]) => hoisted.mockSanitizeEventFirestoreWritePayload(...args),
}));

vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: ['https://example.com'],
  enforceAppCheck: (...args: unknown[]) => hoisted.mockEnforceAppCheck(...args),
}));

import { setEventSharing } from './set-event-sharing';

type SetEventSharingCallableRequest = Parameters<typeof setEventSharing>[0];

function callSetEventSharing(request: {
  auth: { uid: string } | null;
  app: { appId: string };
  data: { userID: string; eventID: string; enabled: boolean };
}) {
  return setEventSharing(request as unknown as SetEventSharingCallableRequest);
}

describe('setEventSharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockEventGet.mockResolvedValue({
      exists: true,
      data: () => ({
        privacy: 'private',
        originalFiles: [
          {
            path: 'users/user-1/events/event-1/original.fit',
            originalFilename: 'watch.fit',
          },
        ],
      }),
    });
    hoisted.mockGetMetadata.mockResolvedValue([
      {
        metadata: {
          existing: 'kept',
        },
      },
    ]);
    hoisted.mockEventUpdate.mockResolvedValue(undefined);
    hoisted.mockSetMetadata.mockResolvedValue(undefined);
    hoisted.mockSanitizeEventFirestoreWritePayload.mockImplementation((payload: unknown) => payload);
  });

  it('registers in the manifest region', () => {
    expect(hoisted.getOnCallOptions()).toMatchObject({
      region: 'europe-west2',
      cors: ['https://example.com'],
    });
  });

  it('allows the owner to enable sharing after validating source files', async () => {
    const result = await callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    });

    expect(hoisted.mockDoc).toHaveBeenCalledWith('users/user-1/events/event-1');
    expect(hoisted.mockSanitizeEventFirestoreWritePayload).toHaveBeenCalledWith({ privacy: 'public' });
    expect(hoisted.mockBucket).toHaveBeenCalledWith();
    expect(hoisted.mockFile).toHaveBeenCalledWith('users/user-1/events/event-1/original.fit');
    expect(hoisted.mockGetMetadata).toHaveBeenCalled();
    expect(hoisted.mockGetMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.mockEventUpdate.mock.invocationCallOrder[0],
    );
    expect(hoisted.mockEventUpdate).toHaveBeenCalledWith({ privacy: 'public' });
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(result).toEqual({
      eventID: 'event-1',
      privacy: 'public',
      publicEventUrl: '/share/event/user-1/event-1',
      publicComparisonUrl: '/share/comparison/user-1/event-1',
    });
  });

  it('allows the owner to disable sharing by updating only event privacy', async () => {
    const result = await callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: false },
    });

    expect(hoisted.mockEventUpdate).toHaveBeenCalledWith({ privacy: 'private' });
    expect(hoisted.mockBucket).not.toHaveBeenCalled();
    expect(hoisted.mockFile).not.toHaveBeenCalled();
    expect(hoisted.mockGetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      eventID: 'event-1',
      privacy: 'private',
    });
  });

  it('allows the owner to enable sharing with legacy originalFile metadata when originalFiles is absent', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        privacy: 'private',
        originalFile: {
          path: 'users/user-1/events/event-1/legacy.fit',
          originalFilename: 'legacy.fit',
        },
      }),
    });

    const result = await callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    });

    expect(hoisted.mockFile).toHaveBeenCalledWith('users/user-1/events/event-1/legacy.fit');
    expect(hoisted.mockEventUpdate).toHaveBeenCalledWith({ privacy: 'public' });
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      eventID: 'event-1',
      privacy: 'public',
    });
  });

  it('rejects enabling sharing when source file metadata is missing', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        privacy: 'private',
        originalFiles: [],
      }),
    });

    await expect(callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockFile).not.toHaveBeenCalled();
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('rejects enabling sharing when source file metadata points outside the event folder', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        privacy: 'private',
        originalFiles: [
          { path: 'users/user-1/events/other-event/original.fit' },
        ],
      }),
    });

    await expect(callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockFile).not.toHaveBeenCalled();
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('rejects enabling sharing when source file metadata path has surrounding whitespace', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        privacy: 'private',
        originalFiles: [
          { path: ' users/user-1/events/event-1/original.fit ' },
        ],
      }),
    });

    await expect(callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockFile).not.toHaveBeenCalled();
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('rejects enabling sharing when source file metadata points outside the default bucket', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        privacy: 'private',
        originalFiles: [
          {
            path: 'users/user-1/events/event-1/original.fit',
            bucket: 'other-bucket',
          },
        ],
      }),
    });

    await expect(callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockFile).not.toHaveBeenCalled();
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('rejects enabling sharing when a source file object is missing', async () => {
    hoisted.mockGetMetadata.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 404 }));

    await expect(callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockFile).toHaveBeenCalledWith('users/user-1/events/event-1/original.fit');
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('does not touch storage when disabling sharing fails', async () => {
    hoisted.mockEventUpdate.mockRejectedValueOnce(new Error('firestore unavailable'));

    await expect(callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: false },
    })).rejects.toMatchObject({ code: 'internal' });

    expect(hoisted.mockEventUpdate).toHaveBeenCalledWith({ privacy: 'private' });
    expect(hoisted.mockBucket).not.toHaveBeenCalled();
    expect(hoisted.mockFile).not.toHaveBeenCalled();
    expect(hoisted.mockGetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated and non-owner callers', async () => {
    await expect(callSetEventSharing({
      auth: null,
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'unauthenticated' });

    await expect(callSetEventSharing({
      auth: { uid: 'other-user' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'permission-denied' });

    expect(hoisted.mockDoc).not.toHaveBeenCalled();
  });

  it('fails safely when the event is missing', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({ exists: false });

    await expect(callSetEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    })).rejects.toMatchObject({ code: 'not-found' });

    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });
});
