import { describe, expect, it } from 'vitest';
import { parsePublicPricingSnapshot } from './public-pricing-snapshot';

const VALID_SNAPSHOT = {
  version: 1,
  generatedAt: '2026-09-04T10:00:00.000Z',
  products: [{
    id: 'membership',
    active: true,
    name: 'Membership',
    description: null,
    role: null,
    images: [],
    metadata: {},
    prices: [{
      id: 'price_basic_monthly',
      active: true,
      currency: 'usd',
      unit_amount: 500,
      description: null,
      type: 'recurring',
      interval: 'month',
      interval_count: 1,
      trial_period_days: null,
      metadata: { firebaseRole: 'basic' },
      recurring: { interval: 'month', interval_count: 1 },
    }],
  }],
};

describe('parsePublicPricingSnapshot', () => {
  it('accepts a generator-shaped public catalog', () => {
    expect(parsePublicPricingSnapshot(VALID_SNAPSHOT)).toEqual(VALID_SNAPSHOT);
  });

  it('rejects empty, expired-shape, and unsafe catalog data before prerendering', () => {
    expect(() => parsePublicPricingSnapshot({ ...VALID_SNAPSHOT, products: [] })).toThrow(/invalid shape/i);
    expect(() => parsePublicPricingSnapshot({ ...VALID_SNAPSHOT, generatedAt: 'not-a-date' })).toThrow(/invalid shape/i);
    expect(() => parsePublicPricingSnapshot({
      ...VALID_SNAPSHOT,
      products: [{ ...VALID_SNAPSHOT.products[0], metadata: { role: 42 } }],
    })).toThrow(/invalid shape/i);
  });
});
