import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { emailSource, emailState, emailEligibility, recordEmailOperation, recordEmailSample, recordEmailTransition } from './monitoring';
import { newEmailDeliveryFields } from './queue-metadata';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
const timestamp = (ms: number) => ({ toMillis: () => ms });
const mail = (data: Record<string, unknown>) => ({ exists: true, data: () => data,
  createTime: timestamp(1000), updateTime: timestamp(2000) } as unknown as FirebaseFirestore.DocumentSnapshot);
describe('direct email monitoring privacy and state meaning', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([[undefined, 'queued'], ['PENDING', 'pending'], ['PROCESSING', 'processing'], ['RETRY', 'retry'],
    ['SUCCESS', 'smtp_accepted'], ['ERROR', 'error'], ['secret state', 'unknown'], [null, 'unknown']])('classifies %s', (state, expected) => {
    expect(emailState({ delivery: { state } })).toBe(expected);
  });
  it('initializes supported pending state and timestamp in the original write, without I/O', () => {
    const fields = newEmailDeliveryFields();
    expect(fields.delivery).toMatchObject({ state: 'PENDING', attempts: 0, error: null });
    expect(fields.queuedAt).toBeDefined(); expect(fields.delivery.startTime).toBeDefined();
    expect(Object.keys(fields)).toEqual(['queuedAt', 'delivery']);
  });
  it('distinguishes partial SMTP acceptance and unsaved marketing tests without exposing recipients', () => {
    expect(emailState({ delivery: { state: 'SUCCESS', info: { rejected: ['private@example.org'] } } })).toBe('smtp_partial');
    expect(emailState({ delivery: { state: 'SUCCESS', info: { pending: ['private@example.org'] } } })).toBe('smtp_partial');
    expect(emailState({ delivery: 'private body' })).toBe('unknown');
    expect(emailSource({ marketing: { campaignId: null } })).toBe('marketing');
  });
  it('keeps pending/retry age and processing leases separate, including legacy documents', () => {
    expect(emailEligibility(mail({ delivery: { state: 'PENDING' } }), 3000)).toMatchObject({ kind: 'due', ageMs: 2000 });
    expect(emailEligibility(mail({ delivery: { state: 'PENDING' }, queuedAt: timestamp(1500) }), 3000)).toMatchObject({ ageMs: 1500 });
    expect(emailEligibility(mail({ delivery: { state: 'RETRY' }, queuedAt: timestamp(0) }), 3000)).toMatchObject({ ageMs: 1000 });
    expect(emailEligibility(mail({ delivery: { state: 'PENDING', attempts: 1 }, queuedAt: timestamp(0) }), 3000)).toMatchObject({ ageMs: 1000 });
    expect(emailEligibility(mail({ delivery: { state: 'PROCESSING', leaseExpireTime: timestamp(5000) } }), 3000).kind).toBe('excluded');
    expect(emailEligibility(mail({ delivery: { state: 'PROCESSING', leaseExpireTime: timestamp(2000) } }), 3000)).toMatchObject({ kind: 'due', ageMs: 1000 });
    expect(emailEligibility(mail({ delivery: { state: 'PROCESSING' } }), 3000).kind).toBe('unknown');
    expect(emailEligibility(mail({ delivery: { state: 'PENDING' }, queuedAt: 'invalid' }), 3000).kind).toBe('unknown');
    expect(emailEligibility(mail({ delivery: { state: 'PENDING', attempts: 'invalid' } }), 3000).kind).toBe('unknown');
    expect(emailEligibility(mail({ delivery: { state: 'SUCCESS' } }), 3000).kind).toBe('excluded');
  });
  it('emits fixed categories only and suppresses unchanged metadata updates', () => {
    recordEmailTransition({ delivery: { state: 'PENDING' } }, { to: 'private@example.org', message: { text: 'private body' }, delivery: { state: 'SUCCESS' } });
    recordEmailTransition({ delivery: { state: 'SUCCESS', attempts: 1 } }, { delivery: { state: 'SUCCESS', attempts: 1 } });
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(1);
    recordEmailOperation('dispatch', 'failed', Infinity);
    const extraFields = { sampled: 0, excludedSample: 0, unknownSample: 0, truncated: false, dueSample: 0, ageLowerBoundMs: 0, body: 'private' };
    recordEmailSample('marketing', extraFields);
    expect(JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls])).not.toContain('private');
    expect(vi.mocked(logger.warn).mock.calls[0][1]).toMatchObject({ operation: 'dispatch', outcome: 'failed', submitted: 0 });
  });
  it('logging failures never change delivery behavior', () => {
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('logging unavailable'); });
    expect(() => recordEmailTransition({}, { delivery: { state: 'PENDING' } })).not.toThrow();
  });
});
