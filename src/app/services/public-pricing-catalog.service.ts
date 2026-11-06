import { Injectable, TransferState, inject } from '@angular/core';
import { Firestore } from 'app/firebase/firestore';
import { Observable, defer, from, of, shareReplay } from 'rxjs';
import type { StripeProduct } from './app.payment.service';
import { getPublicPricingProductsFromFirestore } from './public-pricing-catalog.store';
import { PUBLIC_PRICING_TRANSFER_STATE_KEY } from './public-pricing-snapshot';

/**
 * The deliberately small public catalog boundary used by /pricing and its SEO
 * resolver. It does not depend on authentication, checkout, dialogs, or
 * membership management code.
 */
@Injectable({ providedIn: 'root' })
export class PublicPricingCatalogService {
  private readonly firestore = inject(Firestore);
  private readonly transferState = inject(TransferState, { optional: true });
  private readonly products$ = defer(() => {
    const transferredProducts = this.transferState?.get(PUBLIC_PRICING_TRANSFER_STATE_KEY, null) ?? null;
    if (transferredProducts !== null) {
      this.transferState?.remove(PUBLIC_PRICING_TRANSFER_STATE_KEY);
      return of(transferredProducts);
    }

    return from(getPublicPricingProductsFromFirestore(this.firestore));
  }).pipe(shareReplay({ bufferSize: 1, refCount: false }));

  getProducts(): Observable<StripeProduct[]> {
    return this.products$;
  }
}
