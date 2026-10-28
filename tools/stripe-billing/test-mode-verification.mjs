import assert from 'node:assert/strict';

// Provider evidence for the synthetic free-trial case; not a revenue metric.
export function assertProTrialCheckout({ session, subscription, customer, invoice }) {
  assert.equal(session.payment_method_collection, 'always');
  assert.equal(subscription.status, 'trialing');
  assert.ok(subscription.default_payment_method || customer.invoice_settings?.default_payment_method,
    'Trial must retain a payment method.');
  assert.equal(invoice.status, 'paid', 'The zero-value trial invoice must be settled.');
  assert.equal(invoice.amount_due, 0, 'A free trial must not have a subscription payment due.');
  assert.equal(invoice.amount_paid, 0, 'The free trial must not charge a subscription payment.');
}
