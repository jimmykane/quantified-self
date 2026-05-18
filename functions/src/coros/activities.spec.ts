'use strict';

import { describe, it, vi, expect, beforeEach } from 'vitest';
import { PRO_REQUIRED_MESSAGE } from '../utils';

const requestMocks = {
  post: vi.fn(),
};

const tokensMocks = {
  getTokenData: vi.fn(),
};

const corosAuthApiMocks = {
  getCOROSUserId: vi.fn(),
};

const utilsMocks = {
  hasProAccess: vi.fn(),
};

vi.mock('../request-helper', () => ({
  default: {
    post: (...args: any[]) => requestMocks.post(...args),
  },
  post: (...args: any[]) => requestMocks.post(...args),
}));

vi.mock('../tokens', () => ({
  getTokenData: (...args: any[]) => tokensMocks.getTokenData(...args),
}));

vi.mock('./auth/api', () => ({
  getCOROSUserId: (...args: any[]) => corosAuthApiMocks.getCOROSUserId(...args),
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    hasProAccess: (...args: any[]) => utilsMocks.hasProAccess(...args),
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: any, handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-admin', () => {
  const getMock = vi.fn();
  const setMock = vi.fn();

  const collectionMock: any = vi.fn();
  const docMock: any = vi.fn();

  const colObj = { doc: docMock, get: getMock, set: setMock, collection: collectionMock };
  const docObj = { collection: collectionMock, get: getMock, set: setMock };

  collectionMock.mockReturnValue(colObj);
  docMock.mockReturnValue(docObj);

  getMock.mockResolvedValue({
    size: 1,
    empty: false,
    docs: [{ id: 'token1', data: () => ({}) }],
  });

  return {
    firestore: Object.assign(() => ({ collection: collectionMock }), {
      FieldValue: {
        increment: vi.fn((val) => ({ type: 'increment', val })),
      },
    }),
    initializeApp: vi.fn(),
  };
});

import { importActivityToCOROSAPI } from './activities';

function createMockRequest(overrides: Partial<{ auth: { uid: string } | null; app: object | null; data: any }> = {}) {
  return {
    auth: overrides.auth !== undefined ? overrides.auth : { uid: 'test-user-id' },
    app: overrides.app !== undefined ? overrides.app : { appId: 'test-app' },
    data: overrides.data ?? {},
  };
}

describe('importActivityToCOROSAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    utilsMocks.hasProAccess.mockResolvedValue(true);
    tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'coros-token', openId: 'open-id-1' });
    corosAuthApiMocks.getCOROSUserId.mockResolvedValue('open-id-fallback');
    requestMocks.post.mockResolvedValue(JSON.stringify({
      result: '0000',
      message: 'OK',
      data: [{ labelId: 12345 }],
    }));
  });

  it('uploads successfully and returns labelId', async () => {
    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    const result = await importActivityToCOROSAPI(request as any);

    expect(result).toEqual(expect.objectContaining({
      status: 'success',
      labelId: '12345',
    }));

    expect(tokensMocks.getTokenData).toHaveBeenCalled();
    expect(requestMocks.post).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/coros/file/synchronous'),
      headers: expect.objectContaining({ token: 'coros-token' }),
      json: false,
      body: expect.any(Buffer),
    }));
  });

  it('returns ALREADY_EXISTS when COROS reports duplicate (5082)', async () => {
    requestMocks.post.mockResolvedValueOnce(JSON.stringify({
      result: '5082',
      message: 'Already uploaded',
    }));

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    const result = await importActivityToCOROSAPI(request as any);

    expect(result).toEqual(expect.objectContaining({
      status: 'info',
      code: 'ALREADY_EXISTS',
    }));
  });

  it('falls back to fetching openId when missing on token', async () => {
    tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'coros-token', openId: '' });

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    await importActivityToCOROSAPI(request as any);

    expect(corosAuthApiMocks.getCOROSUserId).toHaveBeenCalledWith('coros-token', 'https://open.coros.com');
  });

  it('throws unauthenticated when missing openId cannot be resolved', async () => {
    tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'coros-token', openId: '' });
    corosAuthApiMocks.getCOROSUserId.mockRejectedValueOnce(new Error('no open id'));

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('maps auth-related COROS code to unauthenticated', async () => {
    requestMocks.post.mockResolvedValueOnce(JSON.stringify({
      result: '5006',
      message: 'invalid authorization',
    }));

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('maps invalid payload/unsupported code to invalid-argument', async () => {
    requestMocks.post.mockResolvedValueOnce(JSON.stringify({
      result: '5096',
      message: 'unsupported workout data',
    }));

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('preserves provider message when HTTP error payload is a string', async () => {
    requestMocks.post.mockRejectedValueOnce({
      statusCode: 500,
      error: 'COROS rejected payload as malformed FIT',
    });

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'internal',
      message: 'COROS rejected payload as malformed FIT',
    });
  });

  it('throws unauthenticated when no COROS token exists', async () => {
    const admin = await import('firebase-admin');
    const getMock = admin.firestore().collection('COROSAPIAccessTokens').doc('test-user-id').collection('tokens').get;
    getMock.mockResolvedValueOnce({ size: 0, empty: true, docs: [] });

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('increments uploadedActivitiesCount only on success', async () => {
    const admin = await import('firebase-admin');
    const setMock = admin.firestore().collection('users').doc('test-user-id').collection('meta').doc('COROSAPI').set;

    const request = createMockRequest({
      data: { file: Buffer.from('fit-data').toString('base64') },
    });

    await importActivityToCOROSAPI(request as any);

    expect(setMock).toHaveBeenCalledTimes(1);

    requestMocks.post.mockResolvedValueOnce(JSON.stringify({ result: '5082', message: 'duplicate' }));
    await importActivityToCOROSAPI(request as any);

    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it('blocks unauthenticated requests', async () => {
    const request = createMockRequest({
      auth: null,
      data: { file: 'abc' },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('blocks requests without App Check', async () => {
    const request = createMockRequest({
      app: null,
      data: { file: 'abc' },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('blocks non-pro users', async () => {
    utilsMocks.hasProAccess.mockResolvedValueOnce(false);

    const request = createMockRequest({
      data: { file: 'abc' },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'permission-denied',
      message: PRO_REQUIRED_MESSAGE,
    });
  });

  it('rejects missing file payload', async () => {
    const request = createMockRequest({ data: {} });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects files larger than 20MB before uploading to COROS', async () => {
    const request = createMockRequest({
      data: { file: Buffer.alloc((20 * 1024 * 1024) + 1).toString('base64') },
    });

    await expect(importActivityToCOROSAPI(request as any)).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Cannot upload activity because the size is greater than 20MB',
    });
    expect(requestMocks.post).not.toHaveBeenCalled();
  });
});
