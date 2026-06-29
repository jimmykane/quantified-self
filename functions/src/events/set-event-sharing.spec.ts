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

  it('allows the owner to enable sharing and marks source files public first', async () => {
    const result = await setEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any);

    expect(hoisted.mockDoc).toHaveBeenCalledWith('users/user-1/events/event-1');
    expect(hoisted.mockFile).toHaveBeenCalledWith('users/user-1/events/event-1/original.fit');
    expect(hoisted.mockSanitizeEventFirestoreWritePayload).toHaveBeenCalledWith({ privacy: 'public' });
    expect(hoisted.mockSetMetadata).toHaveBeenCalledWith({
      metadata: {
        existing: 'kept',
        privacy: 'public',
      },
    });
    expect(hoisted.mockEventUpdate).toHaveBeenCalledWith({ privacy: 'public' });
    expect(hoisted.mockSetMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.mockEventUpdate.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      eventID: 'event-1',
      privacy: 'public',
      publicEventUrl: '/share/event/user-1/event-1',
      publicComparisonUrl: '/share/comparison/user-1/event-1',
    });
  });

  it('allows the owner to disable sharing and marks source files private first', async () => {
    const result = await setEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: false },
    } as any);

    expect(hoisted.mockEventUpdate).toHaveBeenCalledWith({ privacy: 'private' });
    expect(hoisted.mockSetMetadata).toHaveBeenCalledWith({
      metadata: {
        existing: 'kept',
        privacy: 'private',
      },
    });
    expect(hoisted.mockSetMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.mockEventUpdate.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      eventID: 'event-1',
      privacy: 'private',
    });
  });

  it('rejects unauthenticated and non-owner callers', async () => {
    await expect(setEventSharing({
      auth: null,
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any)).rejects.toMatchObject({ code: 'unauthenticated' });

    await expect(setEventSharing({
      auth: { uid: 'other-user' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any)).rejects.toMatchObject({ code: 'permission-denied' });

    expect(hoisted.mockDoc).not.toHaveBeenCalled();
  });

  it('fails safely when the event is missing', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({ exists: false });

    await expect(setEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any)).rejects.toMatchObject({ code: 'not-found' });

    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('fails safely when source file metadata points outside the event folder', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        originalFiles: [
          { path: 'users/user-1/events/other-event/original.fit' },
        ],
      }),
    });

    await expect(setEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any)).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('fails safely when source file metadata points outside the default bucket', async () => {
    hoisted.mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        originalFiles: [
          {
            path: 'users/user-1/events/event-1/original.fit',
            bucket: 'other-bucket',
          },
        ],
      }),
    });

    await expect(setEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any)).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(hoisted.mockFile).not.toHaveBeenCalled();
    expect(hoisted.mockSetMetadata).not.toHaveBeenCalled();
    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('does not make the event public when source metadata cannot be updated', async () => {
    hoisted.mockGetMetadata.mockRejectedValueOnce(new Error('not found'));

    await expect(setEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any)).rejects.toMatchObject({ code: 'internal' });

    expect(hoisted.mockEventUpdate).not.toHaveBeenCalled();
  });

  it('rolls public source-file metadata back when enabling fails after storage updates', async () => {
    hoisted.mockEventUpdate.mockRejectedValueOnce(new Error('firestore unavailable'));

    await expect(setEventSharing({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { userID: 'user-1', eventID: 'event-1', enabled: true },
    } as any)).rejects.toMatchObject({ code: 'internal' });

    expect(hoisted.mockSetMetadata).toHaveBeenNthCalledWith(1, {
      metadata: {
        existing: 'kept',
        privacy: 'public',
      },
    });
    expect(hoisted.mockSetMetadata).toHaveBeenNthCalledWith(2, {
      metadata: {
        existing: 'kept',
        privacy: 'private',
      },
    });
  });
});
