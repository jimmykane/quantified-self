import { describe, expect, it } from 'vitest';
import type { StripeProduct } from '../services/app.payment.service';
import { membershipPriceId, membershipPriceIdFromReturnUrl, membershipReturnUrl, prioritizeMembershipSelection } from './membership-selection.helper';

function product(role: string): StripeProduct {
  return {
    id: role, name: role, role, active: true, description: null, images: [], metadata: { role },
    prices: ['month', 'year'].map(interval => ({
      id: `price_${role}_${interval}`, active: true, currency: 'eur', unit_amount: 299,
      description: null, type: 'recurring' as const, interval: interval as 'month' | 'year',
      interval_count: 1, trial_period_days: null,
    })),
  };
}

describe('membership selection', () => {
  it('carries an exact price through a local membership return URL', () => {
    expect(membershipReturnUrl('price_pro_year')).toBe('/subscriptions?priceId=price_pro_year');
    expect(membershipPriceIdFromReturnUrl('/subscriptions?priceId=price_pro_year')).toBe('price_pro_year');
    expect(membershipPriceIdFromReturnUrl('/subscriptions?priceId=price_pro_year&returnUrl=https://other.test')).toBe('price_pro_year');
  });

  it.each([null, '', 'free_price', 'price_<script>', 'price_a/b', 'price_a?b', 'price_' + 'a'.repeat(181)])('ignores malformed or non-paid price IDs: %s', value => {
    expect(membershipPriceId(value)).toBeNull();
    expect(membershipReturnUrl(value)).toBe('/subscriptions');
  });

  it.each([
    '/subscriptions', '//other.test/subscriptions?priceId=price_pro_year',
    'https://other.test/subscriptions?priceId=price_pro_year', '/subscriptions/../other?priceId=price_pro_year',
    '/subscriptions?priceId=price_pro_year#other', '/subscriptions?priceId=price_pro_year&priceId=price_basic_month',
  ])('does not broaden the onboarding destination allowlist: %s', value => {
    expect(membershipPriceIdFromReturnUrl(value)).toBeNull();
  });

  it('shows the chosen product and cadence first without mutating the catalog', () => {
    const products = [product('free'), product('basic'), product('pro')];
    const before = structuredClone(products);
    const selected = prioritizeMembershipSelection(products, 'price_pro_year');
    expect(selected.products.map(item => item.id)).toEqual(['pro', 'free', 'basic']);
    expect(selected.products[0].prices.map(price => price.id)).toEqual(['price_pro_year', 'price_pro_month']);
    expect(selected.selectedPriceId).toBe('price_pro_year');
    expect(selected.selectionUnavailable).toBe(false);
    expect(products).toEqual(before);
  });

  it('keeps the normal catalog when no choice was made', () => {
    const products = [product('free'), product('pro')];
    expect(prioritizeMembershipSelection(products, null)).toEqual({ products, selectedPriceId: null, selectionUnavailable: false });
  });

  it.each(['missing', 'inactive-product', 'inactive-price', 'one-time', 'free'])('does not select unavailable or ineligible catalog entries: %s', reason => {
    const products = [product(reason === 'free' ? 'free' : 'pro')];
    const requested = reason === 'free' ? 'price_free_month' : 'price_pro_month';
    if (reason === 'inactive-product') products[0].active = false;
    if (reason === 'inactive-price') products[0].prices[0].active = false;
    if (reason === 'one-time') products[0].prices[0].type = 'one_time';
    const selected = prioritizeMembershipSelection(products, reason === 'missing' ? 'price_missing' : requested);
    expect(selected).toEqual({ products, selectedPriceId: null, selectionUnavailable: true });
  });
});
