import { describe, expect, it } from 'vitest';
import type { UserRecord } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { inactiveIdentity, inactivityMode, isTerminalSubscription, sixMonthsAfter, timestampMillis, warningAcceptedAt } from './inactivity-policy';

it('retains submillisecond server timestamp precision without accepting malformed values', () => {
    const time = { toMillis: () => 1_800_000_000_123.456 };
    expect(timestampMillis(time)).toBe(1_800_000_000_123.456);
    for (const n of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
        expect(timestampMillis({ toMillis: () => n })).toBeNull();
    }
    expect(timestampMillis('2026-11-13')).toBeNull();
});

const now = Date.parse('2026-11-13T12:00:00Z');
const user = (patch: Record<string, unknown> = {}) => ({ uid: 'synthetic', email: 'synthetic@example.com',
    metadata: { creationTime: '2020-01-01T00:00:00Z', lastSignInTime: '2026-01-01T00:00:00Z' }, ...patch } as UserRecord);
describe('inactivity eligibility', () => {
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
    it.each(['PENDING', 'PROCESSING', 'RETRY', 'ERROR'])('does not accept %s', state => {
        const value = mail(); value.delivery.state = state; expect(accepted(value)).toBeNull();
    });
    it('rejects wrong owners, recipients, episodes, and missing mail', () => {
        expect(accepted({ ...mail(), uid: 'other' })).toBeNull();
        expect(accepted({ ...mail(), to: 'other@example.com' })).toBeNull();
        expect(accepted({ ...mail(), inactivity: { generation: 'old' } })).toBeNull();
        expect(accepted({})).toBeNull();
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
