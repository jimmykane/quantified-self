import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), legal: vi.fn(), read: vi.fn() }));
vi.mock('./access', () => ({ assertAssistantLegalAccess: mocks.legal }));
vi.mock('./daily-workout-suggestion-store', () => ({
  createDailyWorkoutSuggestionStore: () => ({ read: mocks.read }),
  readDailyWorkoutHistoryImportActive: vi.fn(),
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

import { runDailyWorkoutSuggestion } from './daily-workout-suggestion';

describe('daily workout production access wiring', () => {
  const now = new Date('2026-11-21T08:00:00Z');
  const identity = { auth: { uid: 'test-owner' }, app: {} };
  const input = { mode: 'daily-suggestion', action: 'status' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    vi.spyOn(admin, 'auth').mockReturnValue({ getUser: mocks.getUser } as unknown as admin.auth.Auth);
    mocks.legal.mockResolvedValue(undefined);
    mocks.read.mockResolvedValue({ preferences: null, status: { localDate: '2026-11-21', state: 'off' } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each([
    { stripeRole: 'pro' },
    { stripeRole: 'free', gracePeriodUntil: now.getTime() + 60_000 },
    { stripeRole: 'basic', gracePeriodUntil: now.getTime() + 60_000 },
  ])('admits paid Pro or active grace through the real default check: %j', async customClaims => {
    mocks.getUser.mockResolvedValue({ customClaims });
    await expect(runDailyWorkoutSuggestion(input, identity)).resolves.toMatchObject({ state: 'off' });
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith('test-owner');
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('test-owner');
    expect(logger.info).not.toHaveBeenCalledWith('[DailyWorkoutSuggestion]',
      expect.objectContaining({ outcome: 'access_rejected' }));
  });

  it.each([
    { stripeRole: 'free' },
    { stripeRole: 'basic' },
    { stripeRole: 'free', gracePeriodUntil: now.getTime() },
    { stripeRole: 'free', gracePeriodUntil: now.getTime() - 1 },
  ])('rejects missing or expired Pro access before private state: %j', async customClaims => {
    mocks.getUser.mockResolvedValue({ customClaims });
    await expect(runDailyWorkoutSuggestion(input, identity)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[DailyWorkoutSuggestion]', {
      outcome: 'access_rejected', accessCheck: 'pro', accessReason: 'pro_required',
    });
  });

  it('keeps an unreadable role retryable without reading private state', async () => {
    mocks.getUser.mockRejectedValue(Object.assign(new Error('PRIVATE_AUTH_MESSAGE'), { code: 'auth/network-request-failed' }));
    await expect(runDailyWorkoutSuggestion(input, identity)).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[DailyWorkoutSuggestion]', {
      outcome: 'access_rejected', accessCheck: 'pro', accessReason: 'check_failed',
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
  });

  it.each([
    { error: new HttpsError('permission-denied', 'PRIVATE_CONSENT_MESSAGE'), reason: 'legal_consent_required' },
    { error: new Error('PRIVATE_DATABASE_MESSAGE'), reason: 'check_failed' },
  ])('logs safe legal rejection reasons while preserving the error ($reason)', async ({ error, reason }) => {
    mocks.legal.mockRejectedValue(error);
    await expect(runDailyWorkoutSuggestion(input, identity)).rejects.toBe(error);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[DailyWorkoutSuggestion]', {
      outcome: 'access_rejected', accessCheck: 'legal', accessReason: reason,
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toMatch(/PRIVATE|test-owner/);
  });

  it('preserves a denied access result if logging fails', async () => {
    mocks.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
    vi.mocked(logger.info).mockImplementationOnce(() => { throw Error('PRIVATE_LOGGER_MESSAGE'); });
    await expect(runDailyWorkoutSuggestion(input, identity)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
