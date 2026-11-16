import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicPricingProductsFromFirestore } from './public-pricing-catalog.store';

const {
  mockGetDocFromServer, mockDoc,
  mockCollection,
  mockGetDocsFromServer,
  mockQuery,
  mockWhere,
} = vi.hoisted(() => ({
  mockGetDocFromServer: vi.fn(), mockDoc: vi.fn(),
  mockCollection: vi.fn(),
  mockGetDocsFromServer: vi.fn(),
  mockQuery: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock('app/firebase/firestore', async () => {
  const actual = await vi.importActual('app/firebase/firestore');
  return {
    ...actual, getDocFromServer: mockGetDocFromServer, doc: mockDoc,
    collection: mockCollection,
    getDocsFromServer: mockGetDocsFromServer,
    query: mockQuery,
    where: mockWhere,
  };
});

describe('getPublicPricingProductsFromFirestore', () => {
  beforeEach(() => { mockGetDocFromServer.mockResolvedValue({ data: () => undefined }); mockDoc.mockImplementation((_db, path) => ({ path })); });
  it('uses the same active product and price transformation as membership management', async () => {
    mockCollection.mockImplementation((_firestore: unknown, path: string) => ({ path }));
    mockWhere.mockReturnValue({ type: 'active-filter' });
    mockQuery.mockImplementation((reference: unknown) => reference);
    mockGetDocsFromServer
      .mockResolvedValueOnce({ docs: [{
        id: 'membership',
        data: () => ({
          active: true,
          name: 'Membership',
          description: null,
          images: [],
          metadata: {},
        }),
      }] })
      .mockResolvedValueOnce({ docs: [{
        id: 'price_basic_monthly',
        data: () => ({
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
        }),
      }] });

    const products = await getPublicPricingProductsFromFirestore({} as never);

    expect(mockCollection).toHaveBeenNthCalledWith(1, {}, 'products');
    expect(mockCollection).toHaveBeenNthCalledWith(2, {}, 'products/membership/prices');
    expect(mockWhere).toHaveBeenCalledWith('active', '==', true);
    expect(products).toEqual([expect.objectContaining({
      id: 'membership_basic',
      role: 'basic',
      prices: [expect.objectContaining({ id: 'price_basic_monthly' })],
    })]);
  });
});

import { applyBillingTrialPolicy, withoutIntroductoryTrialOffers } from './pricing-product-catalog';
import type { StripeProduct } from './app.payment.service';
describe('catalog trial offer projection', () => {
  const products = [{ id: 'basic', metadata: { firebaseRole: 'basic' }, prices: [
    { id: 'monthly', type: 'recurring', metadata: { trial_days: '30' } },
    { id: 'yearly', type: 'recurring', metadata: { trial_days: '30' } },
  ] }, { id: 'pro', metadata: { firebaseRole: 'pro' }, prices: [{ id: 'pro', type: 'recurring', metadata: { trial_days: '30' } }] }] as StripeProduct[];
  it('overrides every cadence independently, preserving the input', () => {
    const result = applyBillingTrialPolicy(products, { revision: 1, basicTrialDays: 0, proTrialDays: 14 });
    expect(result[0].prices.map(price => price.metadata.trial_days)).toEqual(['0', '0']);
    expect(result[1].prices[0]).toMatchObject({ trial_period_days: 14, trialPolicyRevision: 1, metadata: { trial_days: '14' } });
    expect(products[0].prices[0].metadata.trial_days).toBe('30');
  });
  it('never advertises deployment-time trials before live policy resolution', () => {
    expect(withoutIntroductoryTrialOffers(products).flatMap(product => product.prices).every(price => price.metadata.trial_days === '0' && price.trial_period_days === null)).toBe(true);
    expect(products[0].prices[0].metadata.trial_days).toBe('30');
  });
});
