import { TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Firestore } from 'app/firebase/firestore';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type StripeProduct } from './app.payment.service';
import { PublicPricingCatalogService } from './public-pricing-catalog.service';
import { PUBLIC_PRICING_TRANSFER_STATE_KEY } from './public-pricing-snapshot';

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
  afterEach(() => TestBed.resetTestingModule());

  it('uses and consumes the prerendered catalog without a second client read', async () => {
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
});
