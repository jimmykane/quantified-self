import { describe, expect, it, vi } from 'vitest';
import { getPublicPricingProductsFromFirestore } from './public-pricing-catalog.store';

const {
  mockCollection,
  mockGetDocsFromServer,
  mockQuery,
  mockWhere,
} = vi.hoisted(() => ({
  mockCollection: vi.fn(),
  mockGetDocsFromServer: vi.fn(),
  mockQuery: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock('app/firebase/firestore', async () => {
  const actual = await vi.importActual('app/firebase/firestore');
  return {
    ...actual,
    collection: mockCollection,
    getDocsFromServer: mockGetDocsFromServer,
    query: mockQuery,
    where: mockWhere,
  };
});

describe('getPublicPricingProductsFromFirestore', () => {
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
