import { describe, expect, it } from 'vitest';
import type { StripeProduct } from '../services/app.payment.service';
import { membershipPriceId, membershipPriceIdFromReturnUrl, membershipReturnUrl, prioritizeMembershipSelection, resolveProMembershipOffer } from './membership-selection.helper';

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

describe('contextual Pro membership offers', () => {
  function catalog() {
    const pro = product('pro');
    pro.prices[0].recurring = { interval: 'month', interval_count: 1 };
    pro.prices[1].recurring = { interval: 'year', interval_count: 1 };
    pro.prices[0].metadata = { trial_days: '30' };
    pro.prices[1].metadata = { trial_days: '14' };
    return [product('basic'), pro];
  }

  it('uses an active Pro price and its exact configured trial without mutating the catalog', () => {
    const products = catalog();
    const original = structuredClone(products);
    expect(resolveProMembershipOffer(products, 'free', false)).toEqual({ priceId: 'price_pro_month', trialDays: 30 });
    expect(products).toEqual(original);
  });

  it.each([true, null])('suppresses trial claims when paid history is %s', history => {
    expect(resolveProMembershipOffer(catalog(), 'free', history)).toEqual({ priceId: 'price_pro_month', trialDays: null });
  });

  it.each(['basic', 'pro', 'unknown'])('suppresses trial claims for a %s account', role => {
    expect(resolveProMembershipOffer(catalog(), role, false).trialDays).toBeNull();
  });

  it.each(['', '0', '-2', '1.5', 'thirty', 'Infinity', '9007199254740992'])('rejects malformed trial metadata: %s', value => {
    const products = catalog();
    for (const price of products[1].prices) price.metadata = { trial_days: value };
    expect(resolveProMembershipOffer(products, 'free', false).trialDays).toBeNull();
  });

  it('binds an annual-only trial to that exact price', () => {
    const products = catalog();
    products[1].prices[0].metadata = {};
    expect(resolveProMembershipOffer(products, 'free', false)).toEqual({ priceId: 'price_pro_year', trialDays: 14 });
  });

  it.each(['inactive-product', 'inactive-price', 'free-price', 'one-time', 'missing-recurring', 'invalid-id'])('does not advertise an unavailable price: %s', reason => {
    const products = catalog();
    const pro = products[1];
    pro.prices = [pro.prices[0]];
    if (reason === 'inactive-product') pro.active = false;
    if (reason === 'inactive-price') pro.prices[0].active = false;
    if (reason === 'free-price') pro.prices[0].unit_amount = 0;
    if (reason === 'one-time') pro.prices[0].type = 'one_time';
    if (reason === 'missing-recurring') pro.prices[0].recurring = null;
    if (reason === 'invalid-id') pro.prices[0].id = 'price_<unsafe>';
    expect(resolveProMembershipOffer(products, 'free', false)).toEqual({ priceId: null, trialDays: null });
  });
});
