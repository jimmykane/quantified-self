import { TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Firestore } from 'app/firebase/firestore';
import { firstValueFrom, skip } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type StripeProduct } from './app.payment.service';
import { PublicPricingCatalogService } from './public-pricing-catalog.service';
import { PUBLIC_PRICING_TRANSFER_STATE_KEY } from './public-pricing-snapshot';


const { renderCallbacks, loadCatalog } = vi.hoisted(() => ({ renderCallbacks: [] as Array<() => void>, loadCatalog: vi.fn() }));
vi.mock('@angular/core', async original => ({ ...await original<typeof import('@angular/core')>(),
  afterNextRender: (callback: () => void) => { renderCallbacks.push(callback); return { destroy() {} }; },
}));
vi.mock('./public-pricing-catalog.store', () => ({ getPublicPricingProductsFromFirestore: loadCatalog }));
const TRANSFERRED_PRODUCTS: StripeProduct[] = [{
  id: 'membership_basic',
  active: true,
  name: 'Basic',
  description: 'Basic',
  role: 'basic',
  images: [],
  metadata: { role: 'basic' },
  prices: [],
}];

describe('PublicPricingCatalogService', () => {
  beforeEach(() => { renderCallbacks.length = 0; loadCatalog.mockReset().mockResolvedValue(TRANSFERRED_PRODUCTS); });
  afterEach(() => TestBed.resetTestingModule());

  it('shares the hydration catalog until the first browser render', async () => {
    const transferState = {
      get: vi.fn().mockReturnValue(TRANSFERRED_PRODUCTS),
      remove: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        PublicPricingCatalogService,
        { provide: Firestore, useValue: {} },
        { provide: TransferState, useValue: transferState },
      ],
    });
    const service = TestBed.inject(PublicPricingCatalogService);

    await expect(firstValueFrom(service.getProducts())).resolves.toEqual(TRANSFERRED_PRODUCTS);
    await expect(firstValueFrom(service.getProducts())).resolves.toEqual(TRANSFERRED_PRODUCTS);

    expect(transferState.get).toHaveBeenCalledTimes(1);
    expect(transferState.get).toHaveBeenCalledWith(PUBLIC_PRICING_TRANSFER_STATE_KEY, null);
    expect(transferState.remove).toHaveBeenCalledWith(PUBLIC_PRICING_TRANSFER_STATE_KEY);
  });
  it('reads current terms after hydration, without reusing the build-time trial', async () => {
    const products = [{ ...TRANSFERRED_PRODUCTS[0], prices: [{ id: 'price_basic', metadata: { trial_days: '30' }, trial_period_days: 30 }] }] as StripeProduct[];
    const current = [{ ...TRANSFERRED_PRODUCTS[0], prices: [{ id: 'price_basic', metadata: { trial_days: '0' }, trial_period_days: null, trialPolicyRevision: 1 }] }] as StripeProduct[];
    loadCatalog.mockResolvedValue(current);
    TestBed.configureTestingModule({ providers: [PublicPricingCatalogService, { provide: Firestore, useValue: {} },
      { provide: TransferState, useValue: { get: () => products, remove: vi.fn() } }] });
    const service = TestBed.inject(PublicPricingCatalogService);
    expect((await firstValueFrom(service.getProducts()))[0].prices[0].metadata.trial_days).toBe('0');
    expect(loadCatalog).not.toHaveBeenCalled();
    const refreshed = firstValueFrom(service.getProducts().pipe(skip(1)));
    renderCallbacks.forEach(callback => callback());
    expect(await refreshed).toEqual(current);
    expect(loadCatalog).toHaveBeenCalledOnce();
  });
  it('does not wait for rendering to resolve a client-side route', async () => {
    TestBed.configureTestingModule({ providers: [PublicPricingCatalogService, { provide: Firestore, useValue: {} },
      { provide: TransferState, useValue: { get: () => null, remove: vi.fn() } }] });
    expect(await firstValueFrom(TestBed.inject(PublicPricingCatalogService).getProducts())).toEqual(TRANSFERRED_PRODUCTS);
    expect(loadCatalog).toHaveBeenCalledOnce();
  });

});
