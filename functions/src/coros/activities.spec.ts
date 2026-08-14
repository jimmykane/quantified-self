'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { PRO_REQUIRED_MESSAGE } from '../utils';
import { COROS_API_REQUEST_TIMEOUT_MS } from './constants';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  getTokenData: vi.fn(),
  hasProAccess: vi.fn(),
  getActiveCOROSTokenSnapshot: vi.fn(),
  getUserDeletionGuardState: vi.fn(),
  isServiceDisconnectPendingForUser: vi.fn(),
  recordSuccessfulActivityUpload: vi.fn(),
  recordActivitySyncOutboundFingerprint: vi.fn(),
}));

vi.mock('../request-helper', () => ({
  default: {
    post: (...args: unknown[]) => mocks.post(...args),
    get: (...args: unknown[]) => mocks.get(...args),
  },
  post: (...args: unknown[]) => mocks.post(...args),
  get: (...args: unknown[]) => mocks.get(...args),
}));

vi.mock('../tokens', () => ({
  getTokenData: (...args: unknown[]) => mocks.getTokenData(...args),
}));

vi.mock('./account', () => ({
  getActiveCOROSTokenSnapshot: (...args: unknown[]) => mocks.getActiveCOROSTokenSnapshot(...args),
  normalizeCOROSOpenId: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    const hasControlCharacter = [...normalized].some(character => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    });
    return normalized && normalized.length <= 200 && !normalized.includes('/') && !hasControlCharacter
      ? normalized
      : null;
  },
}));

vi.mock('../activity-sync/upload-count', () => ({
  recordSuccessfulActivityUpload: (...args: unknown[]) => mocks.recordSuccessfulActivityUpload(...args),
}));

vi.mock('../activity-sync/outbound-fingerprint', () => ({
  recordActivitySyncOutboundFingerprint: (...args: unknown[]) => mocks.recordActivitySyncOutboundFingerprint(...args),
  ActivitySyncOutboundFingerprintSkippedForDeletedUserError: class ActivitySyncOutboundFingerprintSkippedForDeletedUserError extends Error {},
}));

vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: (...args: unknown[]) => mocks.isServiceDisconnectPendingForUser(...args),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: (...args: unknown[]) => mocks.getUserDeletionGuardState(...args),
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
  },
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    hasProAccess: (...args: unknown[]) => mocks.hasProAccess(...args),
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly details?: unknown,
    ) {
      super(message);
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({}),
}));

import {
  getCOROSActivityUploadStatus,
  getCOROSAPIWorkoutFileUploadStatus,
  importActivityToCOROSAPI,
  uploadActivityFileToCOROS,
} from './activities';

type ActivityCallableRequest = Parameters<typeof importActivityToCOROSAPI>[0];
type ActivityStatusCallableRequest = Parameters<typeof getCOROSAPIWorkoutFileUploadStatus>[0];
type ActivityUploadCountOptions = NonNullable<Parameters<typeof getCOROSActivityUploadStatus>[3]>;

const activeUserGuard = {
  userExists: true,
  deletionState: null,
  deletionCompleted: false,
  shouldSkip: false,
};

function tokenSnapshot(openId = 'open-id-1') {
  const snapshot = {
    id: openId,
    exists: true,
    data: () => ({ openId }),
  };
  return {
    ...snapshot,
    ref: { get: vi.fn().mockResolvedValue(snapshot) },
  };
}

function createMockRequest(overrides: Partial<{
  auth: { uid: string } | null;
  app: object | null;
  data: Record<string, unknown>;
}> = {}) {
  return {
    auth: overrides.auth !== undefined ? overrides.auth : { uid: 'test-user-id' },
    app: overrides.app !== undefined ? overrides.app : { appId: 'test-app' },
    data: overrides.data ?? {},
  };
}

function toActivityCallableRequest(request: ReturnType<typeof createMockRequest>): ActivityCallableRequest {
  return request as unknown as ActivityCallableRequest;
}

function toActivityStatusCallableRequest(request: ReturnType<typeof createMockRequest>): ActivityStatusCallableRequest {
  return request as unknown as ActivityStatusCallableRequest;
}

function activityRequest(file = Buffer.from('fit-data')): ActivityCallableRequest {
  return toActivityCallableRequest(createMockRequest({ data: { file: file.toString('base64') } }));
}

describe('COROS asynchronous activity uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasProAccess.mockResolvedValue(true);
    mocks.getUserDeletionGuardState.mockResolvedValue(activeUserGuard);
    mocks.isServiceDisconnectPendingForUser.mockResolvedValue(false);
    mocks.getActiveCOROSTokenSnapshot.mockResolvedValue(tokenSnapshot());
    mocks.getTokenData.mockResolvedValue({ accessToken: 'coros-token', openId: 'open-id-1' });
    mocks.recordSuccessfulActivityUpload.mockResolvedValue(true);
    mocks.recordActivitySyncOutboundFingerprint.mockResolvedValue({
      exactFingerprintId: 'exact-v1-test',
      fingerprintIds: ['exact-v1-test'],
    });
    mocks.post.mockResolvedValue('{"result":"0000","message":"OK","data":[{"uploadId":9223372036854775806}]}');
    mocks.get.mockResolvedValue('{"result":"0000","message":"OK","data":[{"uploadId":9223372036854775806,"status":1}]}');
  });

  it('starts a multipart upload and preserves an unquoted 64-bit upload id', async () => {
    const result = await importActivityToCOROSAPI(activityRequest());

    expect(result).toEqual({
      status: 'pending',
      message: 'COROS is processing the activity.',
      uploadId: '9223372036854775806',
      providerUserId: 'open-id-1',
    });
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/coros/file/upload'),
      headers: expect.objectContaining({
        token: 'coros-token',
        'Content-Type': expect.stringContaining('multipart/form-data; boundary='),
      }),
      json: false,
      body: expect.any(Buffer),
      timeout: COROS_API_REQUEST_TIMEOUT_MS,
    }));
    const requestBody = mocks.post.mock.calls[0][0].body as Buffer;
    expect(requestBody.toString('latin1')).toContain('name="fileType"\r\n\r\n4');
    expect(requestBody.toString('latin1')).toContain('filename="activity.fit"');
    expect(mocks.recordActivitySyncOutboundFingerprint).toHaveBeenCalledWith({
      userID: 'test-user-id',
      destinationServiceName: ServiceNames.COROSAPI,
      fileBuffer: Buffer.from('fit-data'),
    });
    expect(mocks.recordActivitySyncOutboundFingerprint.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.post.mock.invocationCallOrder[0]);
  });

  it('does not persist an echo receipt when no active COROS account is connected', async () => {
    mocks.getActiveCOROSTokenSnapshot.mockRejectedValueOnce(Object.assign(
      new Error('Reconnect COROS before sending data.'),
      { code: 'unauthenticated' },
    ));

    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'Reconnect COROS before sending activities.',
    });
    expect(mocks.recordActivitySyncOutboundFingerprint).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('accepts a provider duplicate without starting another operation', async () => {
    mocks.post.mockResolvedValueOnce(JSON.stringify({ result: '5082', message: 'Already uploaded' }));

    await expect(uploadActivityFileToCOROS('test-user-id', Buffer.from('fit-data'))).resolves.toEqual({
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      message: 'Activity already exists in COROS.',
      providerUserId: 'open-id-1',
    });
  });

  it('maps missing provider entitlement to permission-denied', async () => {
    mocks.post.mockResolvedValueOnce(JSON.stringify({ result: '30009', message: 'No permission' }));

    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('upload permission'),
    });
  });

  it('force-refreshes once when COROS reports an expired access token', async () => {
    mocks.post
      .mockResolvedValueOnce(JSON.stringify({ result: '5006', message: 'Invalid authorization' }))
      .mockResolvedValueOnce(JSON.stringify({ result: '0000', data: [{ uploadId: '42' }] }));

    await expect(uploadActivityFileToCOROS('test-user-id', Buffer.from('fit-data'))).resolves.toMatchObject({
      status: 'pending',
      uploadId: '42',
    });
    expect(mocks.getTokenData).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), false);
    expect(mocks.getTokenData).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), true);
  });

  it('maps unsupported files to invalid-argument', async () => {
    mocks.post.mockResolvedValueOnce(JSON.stringify({ result: '5096', message: 'Unsupported' }));

    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'COROS does not support this activity file.',
    });
  });

  it('classifies rate limiting as a retryable restart', async () => {
    mocks.post.mockRejectedValueOnce({ statusCode: 429 });

    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: expect.objectContaining({ retryMode: 'restart' }),
    });
  });

  it('rejects a success response without a usable upload id', async () => {
    mocks.post.mockResolvedValueOnce(JSON.stringify({ result: '0000', data: [{}] }));

    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('identifier required to reconcile'),
    });
  });

  it('returns pending while COROS is processing', async () => {
    await expect(getCOROSActivityUploadStatus(
      'test-user-id',
      '9223372036854775806',
      'open-id-1',
    )).resolves.toMatchObject({
      status: 'pending',
      uploadId: '9223372036854775806',
      providerUserId: 'open-id-1',
    });
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('uploadId=9223372036854775806'),
      headers: { token: 'coros-token' },
      json: false,
      timeout: COROS_API_REQUEST_TIMEOUT_MS,
    }));
    expect(mocks.recordSuccessfulActivityUpload).not.toHaveBeenCalled();
  });

  it('records a completed upload idempotently with its queue reference', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: [{ uploadId: '42', status: 2 }],
    }));
    const queueItemRef = { id: 'queue-1' } as unknown as NonNullable<ActivityUploadCountOptions['queueItemRef']>;

    await expect(getCOROSActivityUploadStatus(
      'test-user-id',
      '42',
      'open-id-1',
      { queueItemRef },
    )).resolves.toMatchObject({ status: 'success', uploadId: '42' });
    expect(mocks.recordSuccessfulActivityUpload).toHaveBeenCalledWith({
      userID: 'test-user-id',
      serviceName: expect.anything(),
      uploadId: '42',
      queueItemRef,
    });
  });

  it('does not turn a provider-confirmed success into a failure when accounting is unavailable', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: [{ uploadId: '42', status: 2 }],
    }));
    mocks.recordSuccessfulActivityUpload.mockRejectedValueOnce(new Error('Firestore unavailable'));

    await expect(getCOROSActivityUploadStatus(
      'test-user-id',
      '42',
      'open-id-1',
    )).resolves.toMatchObject({ status: 'success', uploadId: '42' });
  });

  it('fails closed when a status response references another upload', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: [{ uploadId: '43', status: 2 }],
    }));

    await expect(getCOROSAPIWorkoutFileUploadStatus(toActivityStatusCallableRequest(createMockRequest({
      data: { uploadId: '42', providerUserId: 'open-id-1' },
    })))).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('different operation'),
    });
  });

  it('allows a fresh direct retry only after COROS confirms processing failed', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: [{ uploadId: '42', status: -1 }],
    }));

    await expect(getCOROSAPIWorkoutFileUploadStatus(toActivityStatusCallableRequest(createMockRequest({
      data: { uploadId: '42', providerUserId: 'open-id-1' },
    })))).rejects.toMatchObject({
      code: 'failed-precondition',
      details: expect.objectContaining({
        retryMode: 'restart',
        providerOperation: 'activity_upload_status',
        resumeUploadId: '42',
      }),
    });
  });

  it('retains COROS processing failure status for structured diagnostics', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: [{ uploadId: '42', status: -1 }],
    }));

    await expect(getCOROSActivityUploadStatus(
      'test-user-id',
      '42',
      'open-id-1',
    )).rejects.toMatchObject({
      code: 'provider-processing-failed',
      providerStatus: -1,
      providerOperationId: '42',
    });
  });

  it('retains the upload operation when COROS returns an unknown status', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: [{ uploadId: '42', status: 99 }],
    }));

    await expect(getCOROSAPIWorkoutFileUploadStatus(toActivityStatusCallableRequest(createMockRequest({
      data: { uploadId: '42', providerUserId: 'open-id-1' },
    })))).rejects.toMatchObject({
      code: 'failed-precondition',
      details: expect.objectContaining({
        retryMode: 'none',
        resumeUploadId: '42',
      }),
    });
  });

  it('requires the same active COROS account when resuming', async () => {
    mocks.getActiveCOROSTokenSnapshot.mockResolvedValueOnce(tokenSnapshot('open-id-2'));
    mocks.getTokenData.mockResolvedValueOnce({ accessToken: 'coros-token', openId: 'open-id-2' });

    await expect(getCOROSActivityUploadStatus('test-user-id', '42', 'open-id-1')).rejects.toMatchObject({
      disposition: 'auth_required',
      providerOperationId: '42',
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('revalidates the active account immediately before starting an upload', async () => {
    mocks.getActiveCOROSTokenSnapshot
      .mockResolvedValueOnce(tokenSnapshot('open-id-1'))
      .mockResolvedValueOnce(tokenSnapshot('open-id-1'))
      .mockResolvedValueOnce(tokenSnapshot('open-id-2'));

    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(mocks.recordActivitySyncOutboundFingerprint).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('revalidates lifecycle and account state after recording the echo receipt', async () => {
    mocks.getActiveCOROSTokenSnapshot
      .mockResolvedValueOnce(tokenSnapshot('open-id-1'))
      .mockResolvedValueOnce(tokenSnapshot('open-id-1'))
      .mockResolvedValueOnce(tokenSnapshot('open-id-1'))
      .mockResolvedValueOnce(tokenSnapshot('open-id-2'));

    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(mocks.recordActivitySyncOutboundFingerprint).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('labels malformed initialization responses with the initialization operation', async () => {
    mocks.post.mockResolvedValueOnce('not-json');

    await expect(uploadActivityFileToCOROS('test-user-id', Buffer.from('fit-data'))).rejects.toMatchObject({
      operation: 'activity_upload_init',
      code: 'invalid-provider-response',
    });
  });

  it('rejects unsafe provider identifiers before building multipart content', async () => {
    mocks.getTokenData.mockResolvedValueOnce({ accessToken: 'coros-token', openId: 'open-id-1\r\ninjected' });

    await expect(uploadActivityFileToCOROS('test-user-id', Buffer.from('fit-data'))).rejects.toMatchObject({
      disposition: 'auth_required',
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('blocks deleted users and pending disconnects before provider access', async () => {
    mocks.getUserDeletionGuardState.mockResolvedValueOnce({ ...activeUserGuard, shouldSkip: true });
    await expect(uploadActivityFileToCOROS('test-user-id', Buffer.from('fit-data'))).rejects.toMatchObject({
      name: 'COROSActivityUploadSkippedForDeletedUserError',
    });
    expect(mocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();

    mocks.getUserDeletionGuardState.mockResolvedValue(activeUserGuard);
    mocks.isServiceDisconnectPendingForUser.mockResolvedValueOnce(true);
    await expect(uploadActivityFileToCOROS('test-user-id', Buffer.from('fit-data'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(mocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();
  });

  it('enforces authentication, App Check, and Pro access', async () => {
    await expect(importActivityToCOROSAPI(toActivityCallableRequest(createMockRequest({ auth: null })))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(importActivityToCOROSAPI(toActivityCallableRequest(createMockRequest({ app: null })))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    mocks.hasProAccess.mockResolvedValueOnce(false);
    await expect(importActivityToCOROSAPI(activityRequest())).rejects.toMatchObject({
      code: 'permission-denied',
      message: PRO_REQUIRED_MESSAGE,
    });
  });

  it('strictly validates base64 and upload size before provider access', async () => {
    await expect(importActivityToCOROSAPI(toActivityCallableRequest(createMockRequest({ data: { file: 'not_base64' } })))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(importActivityToCOROSAPI(toActivityCallableRequest(createMockRequest({ data: {} })))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(importActivityToCOROSAPI(activityRequest(Buffer.alloc((20 * 1024 * 1024) + 1)))).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringContaining('20MB'),
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
