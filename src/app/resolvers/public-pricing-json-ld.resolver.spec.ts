import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { StripeProduct } from '../services/app.payment.service';
import { PublicPricingCatalogService } from '../services/public-pricing-catalog.service';
import { publicPricingJsonLdResolver } from './public-pricing-json-ld.resolver';

const PAID_PRODUCTS: StripeProduct[] = [
  {
    id: 'membership_basic',
    active: true,
    name: 'Basic',
    description: 'Basic',
    role: 'basic',
    images: [],
    metadata: { role: 'basic' },
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
      recurring: { interval: 'month', interval_count: 1 },
    }],
  },
  {
    id: 'membership_pro',
    active: true,
    name: 'Pro',
    description: 'Pro',
    role: 'pro',
    images: [],
    metadata: { role: 'pro' },
    prices: [{
      id: 'price_pro_yearly',
      active: true,
      currency: 'eur',
      unit_amount: 9600,
      description: null,
      type: 'recurring',
      interval: 'year',
      interval_count: 1,
      trial_period_days: null,
      recurring: { interval: 'year', interval_count: 1 },
    }],
  },
];

describe('publicPricingJsonLdResolver', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('uses the same current paid prices as the public pricing catalog', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PublicPricingCatalogService, useValue: { getProducts: () => of(PAID_PRODUCTS) } }],
    });

    const jsonLd = await resolveJsonLd();
    const offers = ((jsonLd['mainEntity'] as Record<string, unknown>)['itemListElement'] ?? []) as Array<Record<string, unknown>>;

    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      url: 'https://quantified-self.io/pricing',
    });
    expect(offers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Starter', price: '0', priceCurrency: 'USD' }),
      expect.objectContaining({ name: 'Basic (month)', price: '5', priceCurrency: 'USD' }),
      expect.objectContaining({ name: 'Pro (year)', price: '96', priceCurrency: 'EUR' }),
    ]));
  });

  it('keeps a safe Starter offer when the public catalog cannot be read at runtime', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PublicPricingCatalogService, useValue: { getProducts: () => throwError(() => new Error('unavailable')) } }],
    });

    const jsonLd = await resolveJsonLd();
    const offers = ((jsonLd['mainEntity'] as Record<string, unknown>)['itemListElement'] ?? []) as Array<Record<string, unknown>>;

    expect(offers).toEqual([expect.objectContaining({ name: 'Starter', price: '0' })]);
  });
});

function resolveJsonLd() {
  return firstValueFrom(TestBed.runInInjectionContext(() => publicPricingJsonLdResolver(
    {} as never,
    {} as never,
  )));
}
