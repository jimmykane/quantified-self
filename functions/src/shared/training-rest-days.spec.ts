import { describe, expect, it } from 'vitest';
import { parseTrainingRestDayV1, parseTrainingCalendarRestDayReview, validateTrainingRestDayRange } from '../../../shared/training-rest-days';

const value = { schemaVersion: 1, localDate: '2026-10-31', isRestDay: true, revision: 1 };
describe('standalone calendar rest dates', () => {
  it('accepts authored intent and retained removal revisions without plans or workouts', () => {
    expect(parseTrainingRestDayV1(value, value.localDate)).toEqual(value);
    expect(parseTrainingRestDayV1({ ...value, isRestDay: false, revision: 2 })).toEqual({ ...value, isRestDay: false, revision: 2 });
  });
  it.each([null, [], { ...value, planId: 'plan' }, { ...value, schemaVersion: 2 }, { ...value, revision: 0 },
    { ...value, revision: 1.5 }, { ...value, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...value, localDate: '2026-02-29' }, { ...value, isRestDay: 'true' }])('rejects malformed or unrelated data %j', input => {
    expect(() => parseTrainingRestDayV1(input)).toThrow();
  });
  it('binds the document identity and bounds complete calendar reads', () => {
    expect(() => parseTrainingRestDayV1(value, '2026-11-01')).toThrow();
    expect(() => validateTrainingRestDayRange('2024-01-01', '2024-12-31')).not.toThrow();
    expect(() => validateTrainingRestDayRange('2024-01-01', '2025-01-01')).toThrow();
    expect(() => validateTrainingRestDayRange('2026-11-01', '2026-10-31')).toThrow();
  });
});

it('requires exact calendar review dates and booleans without identity or plan fields', () => {
  const review = { localDate: value.localDate, before: false, after: true };
  expect(parseTrainingCalendarRestDayReview(review)).toEqual(review);
  for (const bad of [{ ...review, before: undefined }, { ...review, after: 'true' }, { ...review, localDate: '2026-02-29' },
    { ...review, planId: 'private' }, { ...review, revision: 1 }]) expect(() => parseTrainingCalendarRestDayReview(bad)).toThrow();
});
