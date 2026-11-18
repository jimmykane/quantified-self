import { describe, expect, it } from 'vitest';
import type { UserRecord } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { emailFingerprint, finalReminderDue, INACTIVITY_DAY_MS, INACTIVITY_NOTICE_MS, INACTIVITY_REMINDER_MS,
    inactiveIdentity, inactivityMode, isTerminalSubscription, sixMonthsAfter, timestampMillis, warningAcceptedAt } from './inactivity-policy';

it('retains submillisecond server timestamp precision without accepting malformed values', () => {
    const time = { toMillis: () => 1_800_000_000_123.456 };
    expect(timestampMillis(time)).toBe(1_800_000_000_123.456);
    for (const n of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
        expect(timestampMillis({ toMillis: () => n })).toBeNull();
    }
    expect(timestampMillis('2026-11-13')).toBeNull();
});

const now = Date.parse('2026-11-13T12:00:00Z');
describe('final reminder window', () => {
    const deadline = now + INACTIVITY_REMINDER_MS;
    const episode = () => ({ state: 'warned', queuedAt: Timestamp.fromMillis(deadline - INACTIVITY_NOTICE_MS - 1000),
        acceptedAt: Timestamp.fromMillis(deadline - INACTIVITY_NOTICE_MS),
        deleteAfter: Timestamp.fromMillis(deadline), expireAt: Timestamp.fromMillis(deadline + INACTIVITY_DAY_MS) });
    it('opens at seven days remaining and closes at the original deadline', () => {
        expect(finalReminderDue(episode(), now - 1)).toBe(false);
        expect(finalReminderDue(episode(), now)).toBe(true);
        expect(finalReminderDue(episode(), deadline - 1)).toBe(true);
        expect(finalReminderDue(episode(), deadline)).toBe(false);
        expect(finalReminderDue(episode(), deadline + 1)).toBe(false);
    });
    it.each([{ state: 'queued' }, { state: 'cancelled' }, { state: 'deletion_requested' },
        { queuedAt: null }, { queuedAt: Timestamp.fromMillis(now) }, { deleteAfter: Timestamp.fromMillis(deadline - 1) },
        { acceptedAt: null }, { acceptedAt: Timestamp.fromMillis(now + 1) },
        { acceptedAt: Timestamp.fromMillis(deadline - INACTIVITY_NOTICE_MS + 1) },
        { deleteAfter: null }, { expireAt: null }, { expireAt: Timestamp.fromMillis(now) },
        { reminderMailId: 'already-queued' }, { reminderQueuedAt: Timestamp.fromMillis(now - 1) },
        { reminderQueuedAt: null }])('rejects invalid evidence or an already attempted reminder: %j', patch => {
        expect(finalReminderDue({ ...episode(), ...patch }, now)).toBe(false);
    });
    it('honors a notice with a later stored deadline', () => {
        const extended = { ...episode(), deleteAfter: Timestamp.fromMillis(deadline + INACTIVITY_DAY_MS) };
        expect(finalReminderDue(extended, now)).toBe(false);
        expect(finalReminderDue(extended, now + INACTIVITY_DAY_MS)).toBe(true);
    });
});
const user = (patch: Record<string, unknown> = {}) => ({ uid: 'synthetic', email: 'synthetic@example.com',
    metadata: { creationTime: '2020-01-01T00:00:00Z', lastSignInTime: '2026-01-01T00:00:00Z' }, ...patch } as UserRecord);
describe('inactivity eligibility', () => {
    it('distinguishes every Auth email edit from normalized SMTP acceptance', () => {
        expect(emailFingerprint('synthetic@example.com')).not.toBe(emailFingerprint('Synthetic@example.com'));
    });
    it('uses calendar months, clamping month ends and preserving UTC time', () => {
        expect(new Date(sixMonthsAfter(Date.parse('2023-08-31T14:02:03Z'))).toISOString()).toBe('2024-02-29T14:02:03.000Z');
        expect(new Date(sixMonthsAfter(Date.parse('2024-08-31T14:02:03Z'))).toISOString()).toBe('2025-02-28T14:02:03.000Z');
    });
    it('requires strictly more than six months', () => {
        const time = sixMonthsAfter(Date.parse(user().metadata.lastSignInTime));
        expect(inactiveIdentity(user(), time)).toBeNull();
        expect(inactiveIdentity(user(), time + 1)).not.toBeNull();
    });
    it('protects remembered sessions using the latest refresh', () => {
        expect(inactiveIdentity(user({ metadata: { ...user().metadata, lastRefreshTime: new Date(now - 1000).toISOString() } }), now)).toBeNull();
    });
    it.each([
        { disabled: true }, { tenantId: 'another-tenant' }, { email: undefined }, { email: 'invalid' },
        { customClaims: { admin: true } }, { customClaims: { stripeRole: 'basic' } }, { customClaims: { stripeRole: 'pro' } },
        { customClaims: { stripeRole: 'unknown' } }, { customClaims: { gracePeriodUntil: now + 1 } },
        { customClaims: { gracePeriodUntil: 'invalid' } },
    ])('protects excluded identity %j', patch => expect(inactiveIdentity(user(patch), now)).toBeNull());
    it.each(['invalid', '', '2030-01-01', '2019-01-01'])('rejects invalid or inconsistent refresh %s', lastRefreshTime => {
        expect(inactiveIdentity(user({ metadata: { ...user().metadata, lastRefreshTime } }), now)).toBeNull();
    });
    it('allows absent refresh and expired grace, but never substitutes creation for activity', () => {
        expect(inactiveIdentity(user({ customClaims: { stripeRole: 'free', gracePeriodUntil: now - 1 } }), now)).not.toBeNull();
        expect(inactiveIdentity(user({ metadata: { creationTime: user().metadata.creationTime } }), now)).toBeNull();
    });
    it('defaults unknown configuration to off', () => {
        expect(inactivityMode(undefined)).toBe('off');
        expect(inactivityMode('enabled')).toBe('off');
        expect(inactivityMode('enforce')).toBe('enforce');
    });
    it.each(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete', 'unknown', undefined])('protects nonterminal subscription %s', status => {
        expect(isTerminalSubscription(status)).toBe(false);
    });
});
describe('warning acceptance evidence', () => {
    const queued = now - 10000;
    const mail = () => ({ uid: 'synthetic', to: 'synthetic@example.com', template: { name: 'account_inactivity_warning' },
        inactivity: { generation: 'episode' }, delivery: { state: 'SUCCESS', endTime: Timestamp.fromMillis(now - 1000),
            info: { accepted: ['synthetic@example.com'], rejected: [], pending: [] } } });
    const accepted = (value: Record<string, unknown>) => warningAcceptedAt(value, 'synthetic', 'episode', 'synthetic@example.com', queued, now);
    it('starts from SMTP acceptance, not queue creation', () => expect(accepted(mail())).toBe(now - 1000));
    it('accepts the same recipient when SMTP normalizes address casing', () => {
        const value = mail(); value.delivery.info.accepted = ['SYNTHETIC@example.com'];
        expect(accepted(value)).toBe(now - 1000);
    });
    it.each(['PENDING', 'PROCESSING', 'RETRY', 'ERROR'])('does not accept %s', state => {
        const value = mail(); value.delivery.state = state; expect(accepted(value)).toBeNull();
    });
    it('rejects wrong owners, recipients, episodes, and missing mail', () => {
        expect(accepted({ ...mail(), uid: 'other' })).toBeNull();
        expect(accepted({ ...mail(), to: 'other@example.com' })).toBeNull();
        expect(accepted({ ...mail(), inactivity: { generation: 'old' } })).toBeNull();
        expect(accepted({})).toBeNull();
        expect(accepted({ ...mail(), template: { name: 'account_inactivity_final_reminder' } })).toBeNull();
    });
    it('rejects partial or malformed success and impossible times', () => {
        for (const info of [{ accepted: [], rejected: [] }, { accepted: ['other@example.com'], rejected: [] },
            { accepted: ['synthetic@example.com'], rejected: ['other'] }, { accepted: ['synthetic@example.com'] },
            { accepted: ['synthetic@example.com'], rejected: [], pending: ['pending'] }]) {
            expect(accepted({ ...mail(), delivery: { ...mail().delivery, info } })).toBeNull();
        }
        for (const time of [queued - 1, now + 1]) {
            expect(accepted({ ...mail(), delivery: { ...mail().delivery, endTime: Timestamp.fromMillis(time) } })).toBeNull();
        }
    });
});
