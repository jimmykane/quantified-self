import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

const mocks = vi.hoisted(() => ({
  appCheck: vi.fn(), pro: vi.fn(), account: vi.fn(), draft: vi.fn(), transaction: vi.fn(),
  operation: vi.fn(), source: vi.fn(), stop: vi.fn(),
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [], enforceAppCheck: mocks.appCheck, hasProAccess: mocks.pro,
  PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature. Please upgrade to Pro.', enqueueActivitySyncTask: vi.fn(),
}));
vi.mock('./lifecycle', () => ({ reconcileStoppedSend: mocks.stop }));
vi.mock('./store', () => ({
  providerAccount: mocks.account, requireDraft: mocks.draft, guardedSendTransaction: mocks.transaction,
  operationRef: () => ({ get: mocks.operation, collection: () => ({ doc: () => ({ get: mocks.source }) }) }),
  batchRef: vi.fn(), publicBatch: vi.fn(), describeSavedFIT: vi.fn(),
}));
vi.mock('../activity-sync/historical-send', () => ({ eligibleOriginal: vi.fn() }));
vi.mock('../activity-sync/historical-manual-original', () => ({ isStorageObjectMissing: vi.fn() }));
vi.mock('../activity-sync/queue', () => ({ buildActivitySyncQueueItemId: vi.fn() }));

import { activitySendCommand } from './commands';

const PRIVATE = 'private@example.com private-user private.fit https://private.example?token=private-token';
const create = { version: 1, batchId: 'private-batch', action: 'create', provider: 'suunto', source: 'saved' };
function request(data: unknown = create, authenticated = true) {
  return { data, ...(authenticated ? { auth: { uid: 'private-user' } } : {}),
    rawRequest: { headers: { authorization: 'Bearer private-token' } },
  } as Parameters<typeof activitySendCommand.run>[0];
}
function expectSafeLogs() {
  expect(JSON.stringify([...vi.mocked(logger.warn).mock.calls, ...vi.mocked(logger.error).mock.calls])).not.toContain('private');
}

describe('Send command rejection diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pro.mockResolvedValue(true); mocks.account.mockResolvedValue('private-provider-account');
    mocks.draft.mockResolvedValue({ id: 'private-batch', provider: 'suunto', providerAccount: 'private-provider-account', source: 'saved' });
    mocks.operation.mockResolvedValue({ data: () => undefined });
    mocks.source.mockResolvedValue({ data: () => undefined });
  });

  it.each([
    [null, 'unknown', 'unsupported_version'],
    [{ ...create, version: 2 }, 'create', 'unsupported_version'],
    [{ ...create, batchId: PRIVATE }, 'create', 'invalid_reference'],
    [{ ...create, action: PRIVATE }, 'unknown', 'unsupported_action'],
    [{ ...create, provider: PRIVATE }, 'create', 'unsupported_destination_or_source'],
    [{ ...create, action: 'prepare' }, 'prepare', 'saved_selection_missing'],
    [{ ...create, action: 'prepare', startDate: PRIVATE, endDate: PRIVATE }, 'prepare', 'invalid_date_range'],
    [{ ...create, action: 'prepare', sources: [PRIVATE] }, 'prepare', 'unsupported_activity_sources'],
    [{ ...create, action: 'prepare', eventIds: PRIVATE }, 'prepare', 'invalid_selection_shape'],
    [{ ...create, action: 'prepare', eventIds: [] }, 'prepare', 'selection_size_invalid'],
    [{ ...create, action: 'check', rowId: 'private-row' }, 'check', 'provider_operation_missing'],
    [{ ...create, action: 'confirm', revision: 1 }, 'confirm', 'send_not_found'],
  ])('identifies a rejection without copying request data (%s)', async (data, action, reason) => {
    await expect(activitySendCommand.run(request(data))).rejects.toBeInstanceOf(HttpsError);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('[ActivitySendCommand] Request rejected.', {
      stage: 'command', action, reason,
      errorCode: reason === 'send_not_found' ? 'not-found' : ['provider_operation_missing', 'saved_selection_missing'].includes(reason) ? 'failed-precondition' : 'invalid-argument',
      httpStatus: reason === 'send_not_found' ? 404 : 400,
    });
    expect(logger.error).not.toHaveBeenCalled();
    expectSafeLogs();
  });

  it.each([
    ['Destination account changed. Create a new draft.', 'destination_account_changed'],
    ['Preview cursor is no longer current.', 'preview_cursor_stale'],
    ['Account is unavailable.', 'account_unavailable'],
    ['Connect or reconnect the destination in Connections.', 'destination_reconnect_required'],
    ['Create a new send draft.', 'draft_closed'],
    [PRIVATE, 'unclassified'],
  ])('preserves the original rejection and redacts its details (%s)', async (message, reason) => {
    const error = new HttpsError('failed-precondition', message, { uid: PRIVATE, token: PRIVATE });
    mocks.account.mockRejectedValueOnce(error);
    await expect(activitySendCommand.run(request())).rejects.toBe(error);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('[ActivitySendCommand] Request rejected.', {
      stage: 'command', action: 'create', errorCode: 'failed-precondition', httpStatus: 400, reason,
    });
    expectSafeLogs();
  });

  it('logs unexpected failures at ERROR without exposing their code, message or details', async () => {
    const error = Object.assign(new Error(PRIVATE), { code: PRIVATE, details: PRIVATE });
    mocks.pro.mockRejectedValueOnce(error);
    await expect(activitySendCommand.run(request())).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('[ActivitySendCommand] Request rejected.', {
      stage: 'command', action: 'create', errorCode: 'unknown', httpStatus: 500, reason: 'unexpected_error',
    });
    expect(logger.warn).not.toHaveBeenCalled(); expectSafeLogs();
  });

  it('preserves retryable callable failures and logs them at ERROR', async () => {
    const error = new HttpsError('unavailable', PRIVATE, { token: PRIVATE });
    mocks.account.mockRejectedValueOnce(error);
    await expect(activitySendCommand.run(request())).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('[ActivitySendCommand] Request rejected.', {
      stage: 'command', action: 'create', errorCode: 'unavailable', httpStatus: 503, reason: 'unclassified',
    });
    expect(logger.warn).not.toHaveBeenCalled(); expectSafeLogs();
  });

  it('does not log arbitrary error codes even on an HttpsError', async () => {
    const error = new HttpsError('failed-precondition', PRIVATE);
    Object.defineProperty(error, 'code', { value: PRIVATE });
    mocks.account.mockRejectedValueOnce(error);
    await expect(activitySendCommand.run(request())).rejects.toBe(error);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('[ActivitySendCommand] Request rejected.', {
      stage: 'command', action: 'create', errorCode: 'unknown', httpStatus: 400, reason: 'unclassified',
    });
    expectSafeLogs();
  });

  it('keeps authentication and App Check guards ahead of command work', async () => {
    const error = new HttpsError('failed-precondition', PRIVATE);
    mocks.appCheck.mockImplementationOnce(() => { throw error; });
    await expect(activitySendCommand.run(request())).rejects.toBe(error);
    expect(logger.warn).toHaveBeenLastCalledWith('[ActivitySendCommand] Request rejected.', {
      stage: 'app_check', action: 'create', errorCode: 'failed-precondition', httpStatus: 400, reason: 'app_check_rejected',
    });
    await expect(activitySendCommand.run(request(create, false))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(logger.warn).toHaveBeenLastCalledWith('[ActivitySendCommand] Request rejected.', {
      stage: 'authentication', action: 'create', errorCode: 'unauthenticated', httpStatus: 401, reason: 'sign_in_required',
    });
    expect(mocks.pro).not.toHaveBeenCalled(); expectSafeLogs();
  });

  it('does not let logging failures replace the command rejection', async () => {
    const error = new HttpsError('failed-precondition', PRIVATE);
    mocks.account.mockRejectedValueOnce(error);
    vi.mocked(logger.warn).mockImplementationOnce(() => { throw new Error('logger unavailable'); });
    await expect(activitySendCommand.run(request())).rejects.toBe(error);
    expectSafeLogs();
  });

  it('keeps successful command replies unchanged and adds no rejection log', async () => {
    await expect(activitySendCommand.run(request())).resolves.toEqual({ batchId: 'private-batch', revision: 0 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
  });
});
