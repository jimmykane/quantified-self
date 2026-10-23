import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), verifyAppCheck: vi.fn(), enforceAppCheck: vi.fn(), pro: vi.fn(),
  draft: vi.fn(), describe: vi.fn(), decode: vi.fn(), transaction: vi.fn(), matching: vi.fn(),
  save: vi.fn(), metadata: vi.fn(), remove: vi.fn(), cleanup: vi.fn(), adopted: vi.fn(),
}));
vi.mock('firebase-functions/v2/https', async original => ({
  ...await original<typeof import('firebase-functions/v2/https')>(), onRequest: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('firebase-admin', () => ({
  auth: () => ({ verifyIdToken: mocks.verifyIdToken }), appCheck: () => ({ verifyToken: mocks.verifyAppCheck }),
  firestore: () => ({ doc: vi.fn() }),
  storage: () => ({ bucket: () => ({ file: () => ({ save: mocks.save, getMetadata: mocks.metadata, delete: mocks.remove }) }) }),
}));
vi.mock('../utils', () => ({ ALLOWED_CORS_ORIGINS: [], hasProAccess: mocks.pro, shouldEnforceAppCheck: mocks.enforceAppCheck }));
vi.mock('./policy', async original => ({ ...await original<typeof import('./policy')>(), decodeSendFile: mocks.decode, sendFileHash: () => 'synthetic-digest' }));
vi.mock('./store', () => ({
  requireDraft: mocks.draft, describeFIT: mocks.describe, guardedSendTransaction: mocks.transaction,
  operationRef: () => ({ collection: () => ({
    where: () => ({ limit: () => ({ get: mocks.matching }) }), doc: () => ({ get: mocks.adopted }),
  }) }), batchRef: vi.fn(), publicBatch: vi.fn(),
}));
vi.mock('./source-cleanup', () => ({ queueRetiredSendSourceCleanup: mocks.cleanup }));
vi.mock('./upload-cleanup', () => ({ reserveSendUploadCleanup: vi.fn(), sendUploadCleanupRef: vi.fn() }));

import { uploadActivitySendFile } from './upload';

const PRIVATE = 'private-user private@example.com private.fit https://private.example/file?token=private-token';
function request(headers: Record<string, string> = {}) {
  const values = { authorization: 'Bearer private-token', 'X-Firebase-AppCheck': 'private-app-check',
    'X-QS-Batch': 'private-batch', 'X-QS-File': 'private-row', 'X-QS-Filename': 'private.fit', ...headers };
  return { method: 'POST', header: (name: string) => values[name as keyof typeof values], rawBody: Buffer.from('private-file-content') };
}
function response() {
  const res = { set: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.set.mockReturnValue(res); res.status.mockReturnValue(res);
  return res;
}
const invoke = uploadActivitySendFile as unknown as (req: ReturnType<typeof request>, res: ReturnType<typeof response>) => Promise<void>;

describe('Send file rejection diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verifyIdToken.mockResolvedValue({ uid: 'private-user' });
    mocks.verifyAppCheck.mockResolvedValue({}); mocks.enforceAppCheck.mockReturnValue(true);
    mocks.pro.mockResolvedValue(true); mocks.draft.mockResolvedValue({ source: 'files', provider: 'suunto' });
    mocks.decode.mockReturnValue(Buffer.from('synthetic-fit')); mocks.describe.mockResolvedValue({});
    mocks.matching.mockResolvedValue({ empty: true }); mocks.transaction.mockResolvedValue(false);
    mocks.save.mockResolvedValue(undefined); mocks.metadata.mockResolvedValue([{ generation: '1', metadata: { sendDigest: 'synthetic-digest' } }]);
    mocks.cleanup.mockResolvedValue(undefined); mocks.adopted.mockResolvedValue({ data: () => undefined }); mocks.remove.mockResolvedValue(undefined);
  });

  it.each([
    ['entitlement_check', 'pro', 'permission-denied', 403],
    ['draft_validation', 'draft', 'failed-precondition', 400],
    ['file_validation', 'decode', 'invalid-argument', 400],
    ['recording_review', 'describe', 'invalid-argument', 400],
    ['source_reservation', 'transaction', 'resource-exhausted', 429],
  ] as const)('logs only fixed fields at %s and preserves the client response', async (stage, target, code, status) => {
    const error = new HttpsError(code, PRIVATE, { filename: 'private.fit', token: 'private-token' });
    if (target === 'decode') mocks.decode.mockImplementationOnce(() => { throw error; });
    else mocks[target].mockRejectedValueOnce(error);
    const res = response();
    await invoke(request(), res);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ code, message: PRIVATE });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('[ActivitySendUpload] Request rejected.', { stage, errorCode: code, httpStatus: status });
    expect(logger.error).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
  });

  it.each([
    ['storage_write', 'save'], ['storage_metadata', 'metadata'], ['source_adoption', 'transaction'],
  ] as const)('classifies unexpected %s errors without copying them', async (stage, target) => {
    const error = Object.assign(new Error(PRIVATE), { code: PRIVATE, details: { rawBody: PRIVATE } });
    if (target === 'transaction') mocks.transaction.mockResolvedValueOnce(false).mockRejectedValueOnce(error);
    else mocks[target].mockRejectedValueOnce(error);
    const res = response();
    await invoke(request(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ code: 'unavailable', message: 'File staging is temporarily unavailable. Retry the same file.' });
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('[ActivitySendUpload] Request rejected.', { stage, errorCode: 'unknown', httpStatus: 503 });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('private');
    if (target !== 'save') expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it('identifies cleanup failures rather than mislabelling the original storage failure', async () => {
    mocks.metadata.mockRejectedValueOnce(new Error(PRIVATE)); mocks.cleanup.mockRejectedValueOnce(new Error(PRIVATE));
    const res = response();
    await invoke(request(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('[ActivitySendUpload] Request rejected.', {
      stage: 'source_cleanup', errorCode: 'unknown', httpStatus: 503,
    });
  });

  it.each(['missing_bearer', 'invalid_bearer', 'missing_app_check', 'invalid_app_check', 'invalid_reference'])(
    'keeps authentication and request guards unchanged: %s', async failure => {
      const headers: Record<string, string> = {};
      if (failure === 'missing_bearer') headers.authorization = '';
      if (failure === 'invalid_bearer') mocks.verifyIdToken.mockRejectedValueOnce(new Error(PRIVATE));
      if (failure === 'missing_app_check') headers['X-Firebase-AppCheck'] = '';
      if (failure === 'invalid_app_check') mocks.verifyAppCheck.mockRejectedValueOnce(new Error(PRIVATE));
      if (failure === 'invalid_reference') headers['X-QS-Batch'] = '../private-user';
      const res = response();
      await invoke(request(headers), res);
      const reference = failure === 'invalid_reference';
      expect(res.status).toHaveBeenCalledWith(reference ? 400 : 401);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith('[ActivitySendUpload] Request rejected.', {
        stage: reference ? 'request_validation' : failure.includes('app_check') ? 'app_check' : 'authentication',
        errorCode: reference ? 'invalid-argument' : 'unauthenticated', httpStatus: reference ? 400 : 401,
      });
      expect(mocks.pro).not.toHaveBeenCalled();
    },
  );

  it('redacts unknown codes even on a known error and tolerates logging failure', async () => {
    const error = new HttpsError('invalid-argument', PRIVATE);
    Object.defineProperty(error, 'code', { value: 'private-error-code' });
    mocks.decode.mockImplementationOnce(() => { throw error; });
    vi.mocked(logger.warn).mockImplementationOnce(() => { throw new Error('logger unavailable'); });
    const res = response();
    await expect(invoke(request(), res)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('[ActivitySendUpload] Request rejected.', { stage: 'file_validation', errorCode: 'unknown', httpStatus: 400 });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ code: 'private-error-code', message: PRIVATE });
  });

  it('does not add rejection logs or change successful uploads', async () => {
    const res = response();
    await invoke(request(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ batchId: 'private-batch', rowId: 'private-row' });
    expect(logger.warn).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
  });
});
