import { describe, expect, it } from 'vitest';
import { blankStats, remainingToday, selectedPlan, signupInRange, transitionStats, utcDay, validDailyCap } from './core';

const filters = { plans: ['free', 'basic', 'pro'] as const, signupFrom: '2026-01-01', signupTo: '2026-12-31' };

describe('marketing dispatch accounting', () => {
  it('uses UTC days and an inclusive signup range', () => {
    expect(utcDay(new Date('2026-01-01T00:30:00+02:00'))).toBe('2025-12-31');
    expect(signupInRange('2026-01-01T00:00:00.000Z', { ...filters, plans: [...filters.plans] })).toBe(true);
    expect(signupInRange('2026-12-31T23:59:59.999Z', { ...filters, plans: [...filters.plans] })).toBe(true);
    expect(signupInRange('2027-01-01T00:00:00.000Z', { ...filters, plans: [...filters.plans] })).toBe(false);
  });
  it('does not depend on email verification or provider', () => {
    expect(selectedPlan('free', { ...filters, plans: ['free'] })).toBe(true);
    expect(selectedPlan('pro', { ...filters, plans: ['free'] })).toBe(false);
  });
  it('moves counts exactly once and clamps remaining slots after a cap reduction', () => {
    const queued = transitionStats(blankStats(2), 'pending', 'queued');
    expect(transitionStats(queued, 'queued', 'accepted')).toEqual({ eligible: 2, pending: 1, queued: 0, accepted: 1, failed: 0, skipped: 0 });
    expect(remainingToday(10, 12)).toBe(0);
    expect(validDailyCap(10)).toBe(10);
    expect(() => validDailyCap(0)).toThrow();
  });
});
