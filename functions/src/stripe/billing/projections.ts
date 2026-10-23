import type Stripe from 'stripe';
import type { Firestore, DocumentData } from 'firebase-admin/firestore';
import { BillingError, seconds, stripeId } from './model';

export interface Projection { path: string; data: DocumentData }
function metadataFields(metadata: Stripe.Metadata | null): DocumentData {
  return Object.fromEntries(Object.entries(metadata ?? {}).map(([k, v]) => [`stripe_metadata_${k}`, v]));
}
export function productProjection(product: Stripe.Product): Projection {
  return { path: `products/${product.id}`, data: { active: product.active, name: product.name,
    description: product.description, images: product.images, metadata: product.metadata,
    role: product.metadata.firebaseRole ?? product.metadata.role ?? null,
    tax_code: stripeId(product.tax_code), ...metadataFields(product.metadata) } };
}
export function priceProjections(price: Stripe.Price): Projection[] {
  const product = stripeId(price.product);
  if (!product) throw new BillingError('invalid_request');
  const trial = Number(price.metadata.trial_days);
  const trialDays = Number.isInteger(trial) && trial > 0 && trial <= 730 ? trial : 0;
  return [{ path: `products/${product}/prices/${price.id}`, data: { active: price.active,
    currency: price.currency, unit_amount: price.unit_amount, description: price.nickname,
    type: price.type, billing_scheme: price.billing_scheme, recurring: price.recurring,
    interval: price.recurring?.interval ?? null, interval_count: price.recurring?.interval_count ?? null,
    trial_period_days: trialDays || null, tiers_mode: price.tiers_mode, tiers: price.tiers ?? null,
    tax_behavior: price.tax_behavior, metadata: price.metadata, ...metadataFields(price.metadata) } },
  { path: `stripeBillingPrices/${price.id}`, data: { active: price.active, product,
    mode: price.type === 'recurring' ? 'subscription' : 'payment', trialDays } }];
}
export function subscriptionProjection(db: Firestore, uid: string, sub: Stripe.Subscription, products: Stripe.Product[]): Projection {
  if (!sub.items.data.length || sub.items.has_more) throw new BillingError('invalid_request');
  const first = sub.items.data[0];
  const product = products.find(p => p.id === stripeId(first.price.product));
  const role = product?.metadata.firebaseRole ?? product?.metadata.role ?? null;
  if (role !== null && !['free', 'basic', 'pro'].includes(role)) throw new BillingError('invalid_request');
  // Match the current renewal/gift contract: furthest paid-through item end.
  const end = Math.max(...sub.items.data.map(item => item.current_period_end));
  const start = Math.min(...sub.items.data.map(item => item.current_period_start));
  const priceRef = (p: Stripe.Price) => db.doc(`products/${stripeId(p.product)}/prices/${p.id}`);
  return { path: `customers/${uid}/subscriptions/${sub.id}`, data: {
    role, status: sub.status, metadata: sub.metadata,
    stripeLink: `https://dashboard.stripe.com${sub.livemode ? '' : '/test'}/subscriptions/${sub.id}`,
    product: db.doc(`products/${stripeId(first.price.product)}`), price: priceRef(first.price),
    prices: sub.items.data.map(item => priceRef(item.price)), quantity: first.quantity ?? 1,
    items: sub.items.data.map(item => ({ id: item.id, quantity: item.quantity ?? 1,
      price: { id: item.price.id, product: stripeId(item.price.product), unit_amount: item.price.unit_amount,
        currency: item.price.currency, recurring: item.price.recurring, metadata: item.price.metadata } })),
    cancel_at_period_end: sub.cancel_at_period_end, cancel_at: seconds(sub.cancel_at),
    canceled_at: seconds(sub.canceled_at), ended_at: seconds(sub.ended_at), created: seconds(sub.created),
    current_period_start: seconds(start), current_period_end: seconds(end),
    trial_start: seconds(sub.trial_start), trial_end: seconds(sub.trial_end),
  } };
}
export function invoiceProjection(uid: string, invoice: Stripe.Invoice): Projection | null {
  const subscription = stripeId(invoice.parent?.subscription_details?.subscription);
  if (!subscription) return null; // The extension stores subscription invoices only.
  return { path: `customers/${uid}/subscriptions/${subscription}/invoices/${invoice.id}`, data: {
    id: invoice.id, status: invoice.status, currency: invoice.currency, amount_due: invoice.amount_due,
    amount_paid: invoice.amount_paid, amount_remaining: invoice.amount_remaining, total: invoice.total,
    subtotal: invoice.subtotal, created: invoice.created, hosted_invoice_url: invoice.hosted_invoice_url,
    invoice_pdf: invoice.invoice_pdf, period_start: invoice.period_start, period_end: invoice.period_end,
    subscription, customer: stripeId(invoice.customer), metadata: invoice.metadata,
  } };
}
export function paymentProjection(uid: string, payment: Stripe.PaymentIntent): Projection {
  const charge = typeof payment.latest_charge === 'object' ? payment.latest_charge : null;
  return { path: `customers/${uid}/payments/${payment.id}`, data: {
    id: payment.id, amount: payment.amount, amount_received: payment.amount_received,
    currency: payment.currency, status: payment.status, created: payment.created,
    customer: stripeId(payment.customer), description: payment.description, metadata: payment.metadata,
    amount_refunded: charge?.amount_refunded ?? 0, receipt_url: charge?.receipt_url ?? null,
  } };
}
export function taxProjection(tax: Stripe.TaxRate): Projection {
  return { path: `products/tax_rates/tax_rates/${tax.id}`, data: {
    active: tax.active, country: tax.country, state: tax.state, description: tax.description,
    display_name: tax.display_name, inclusive: tax.inclusive, jurisdiction: tax.jurisdiction,
    percentage: tax.percentage, metadata: tax.metadata,
  } };
}
