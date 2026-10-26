import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProTrialCheckout } from './test-mode-verification.mjs';

const evidence = () => ({ session: { payment_method_collection: 'always' },
  subscription: { status: 'trialing', default_payment_method: 'pm_synthetic' },
  customer: { invoice_settings: { default_payment_method: null } },
  invoice: { status: 'paid', amount_due: 0, amount_paid: 0 } });

test('accepts a settled free trial with a retained subscription or customer payment method', () => {
  assert.doesNotThrow(() => assertProTrialCheckout(evidence()));
  const current = evidence(); current.subscription.default_payment_method = null;
  current.customer.invoice_settings.default_payment_method = 'pm_synthetic';
  assert.doesNotThrow(() => assertProTrialCheckout(current));
});
for (const [name, change] of [
  ['optional collection', { session: { payment_method_collection: 'if_required' } }],
  ['no saved payment method', { subscription: { status: 'trialing', default_payment_method: null } }],
  ['an active paid subscription', { subscription: { status: 'active', default_payment_method: 'pm_synthetic' } }],
  ['zero paid but payment still due', { invoice: { status: 'open', amount_due: 1000, amount_paid: 0 } }],
  ['a zero invoice still open', { invoice: { status: 'open', amount_due: 0, amount_paid: 0 } }],
  ['a settled invoice with a nonzero amount due', { invoice: { status: 'paid', amount_due: 1000, amount_paid: 0 } }],
  ['an actual subscription charge', { invoice: { status: 'paid', amount_due: 1000, amount_paid: 1000 } }],
]) test(`rejects false free-trial evidence: ${name}`, () => {
  assert.throws(() => assertProTrialCheckout({ ...evidence(), ...change }));
});
