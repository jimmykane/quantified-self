import {
  collection,
  getDocsFromServer,
  query,
  where,
  type FirebaseFirestoreType,
} from 'app/firebase/firestore';
import type { StripePrice, StripeProduct } from './app.payment.service';
import { transformProductsForPricing } from './pricing-product-catalog';

/** Fetches the signed-out-readable Stripe catalog and normalizes it into plans. */
export async function getPublicPricingProductsFromFirestore(firestore: FirebaseFirestoreType): Promise<StripeProduct[]> {
  const productsRef = collection(firestore, 'products');
  const activeProductsQuery = query(productsRef, where('active', '==', true));
  const productsSnapshot = await getDocsFromServer(activeProductsQuery);
  const products = productsSnapshot.docs.map(productDoc => ({
    id: productDoc.id,
    ...(productDoc.data() as Omit<StripeProduct, 'id'>),
  } as StripeProduct));

  const productsWithPrices = await Promise.all(products.map(async product => {
    const pricesRef = collection(firestore, `products/${product.id}/prices`);
    const activePricesQuery = query(pricesRef, where('active', '==', true));
    const pricesSnapshot = await getDocsFromServer(activePricesQuery);
    const prices = pricesSnapshot.docs.map(priceDoc => ({
      id: priceDoc.id,
      ...(priceDoc.data() as Omit<StripePrice, 'id'>),
    } as StripePrice));

    return { ...product, prices };
  }));

  return transformProductsForPricing(productsWithPrices);
}
