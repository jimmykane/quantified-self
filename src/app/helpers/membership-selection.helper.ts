import type { StripeProduct } from '../services/app.payment.service';

export function membershipPriceId(value: unknown): string | null {
  return typeof value === 'string' && /^price_[A-Za-z0-9_]{1,180}$/.test(value) ? value : null;
}

export function membershipReturnUrl(priceId: unknown): string {
  const selectedPriceId = membershipPriceId(priceId);
  return selectedPriceId ? `/subscriptions?priceId=${selectedPriceId}` : '/subscriptions';
}

export function membershipPriceIdFromReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/subscriptions?') || value.includes('#')) {
    return null;
  }
  const params = new URLSearchParams(value.slice('/subscriptions?'.length));
  return params.getAll('priceId').length === 1 ? membershipPriceId(params.get('priceId')) : null;
}

/** A URL selects only a currently offered option; it never authorizes checkout. */
export function prioritizeMembershipSelection(products: StripeProduct[], requestedPriceId: string | null) {
  const selectedPriceId = membershipPriceId(requestedPriceId);
  const selectedProduct = selectedPriceId ? products.find(product => (
    product.active
    && ['basic', 'pro'].includes(product.metadata?.role ?? product.role)
    && product.prices?.some(price => price.id === selectedPriceId && price.active
      && price.type === 'recurring' && typeof price.unit_amount === 'number' && price.unit_amount > 0)
  )) : undefined;

  if (!selectedProduct) {
    return { products, selectedPriceId: null, selectionUnavailable: selectedPriceId !== null };
  }

  const selected = {
    ...selectedProduct,
    prices: [...selectedProduct.prices].sort((left, right) => (
      Number(right.id === selectedPriceId) - Number(left.id === selectedPriceId)
    )),
  };
  return {
    products: [selected, ...products.filter(product => product !== selectedProduct)],
    selectedPriceId,
    selectionUnavailable: false,
  };
}
