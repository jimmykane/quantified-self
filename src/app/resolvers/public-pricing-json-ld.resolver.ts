import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { catchError, from, switchMap, take } from 'rxjs';
import type { StripeProduct } from '../services/app.payment.service';
import { PublicPricingCatalogService } from '../services/public-pricing-catalog.service';

type PublicPricingJsonLd = Record<string, unknown>;

function buildJsonLd(products: StripeProduct[]) {
  return import('../components/public-pricing/public-pricing.component')
    .then(module => module.buildPublicPricingJsonLd(products));
}

/**
 * Keeps pricing structured data aligned with the rendered catalog without
 * making the pricing component part of the initial application bundle.
 */
export const publicPricingJsonLdResolver: ResolveFn<PublicPricingJsonLd> = () => {
  const pricingCatalogService = inject(PublicPricingCatalogService);

  return pricingCatalogService.getProducts().pipe(
    take(1),
    switchMap(products => from(buildJsonLd(products))),
    catchError(() => from(buildJsonLd([]))),
  );
};
