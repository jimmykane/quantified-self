import { Injectable, TransferState, afterNextRender, inject } from '@angular/core';
import { Firestore } from 'app/firebase/firestore';
import { Observable, ReplaySubject, concat, defer, from, of, shareReplay, switchMap, take } from 'rxjs';
import type { StripeProduct } from './app.payment.service';
import { getPublicPricingProductsFromFirestore } from './public-pricing-catalog.store';
import { withoutIntroductoryTrialOffers } from './pricing-product-catalog';
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
  private readonly browserReady = new ReplaySubject<void>(1);
  constructor() { afterNextRender(() => this.browserReady.next()); }
  private readonly products$ = defer(() => {
    const transferredProducts = this.transferState?.get(PUBLIC_PRICING_TRANSFER_STATE_KEY, null) ?? null;
    this.transferState?.remove(PUBLIC_PRICING_TRANSFER_STATE_KEY);
    const live$ = this.browserReady.pipe(take(1), switchMap(() => from(getPublicPricingProductsFromFirestore(this.firestore))));
    // Preserve hydration, then resolve the current policy. Do not keep deployment-time
    // trial promises in static HTML. Checkout separately checks the displayed revision.
    return transferredProducts !== null ? concat(of(withoutIntroductoryTrialOffers(transferredProducts)), live$)
      : from(getPublicPricingProductsFromFirestore(this.firestore));
  }).pipe(shareReplay({ bufferSize: 1, refCount: false }));

  getProducts(): Observable<StripeProduct[]> {
    return this.products$;
  }
}
