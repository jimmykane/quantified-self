import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSyntheticSubscription, parseRoleArguments } from './local-role.mjs';

test('parses supported local role commands', () => {
  assert.deepEqual(parseRoleArguments(['--email', 'local@example.test', '--role', 'PRO']), {
    email: 'local@example.test',
    role: 'pro',
  });
  assert.throws(() => parseRoleArguments(['--email', 'invalid', '--role', 'pro']), /email/u);
  assert.throws(() => parseRoleArguments(['--email', 'local@example.test', '--role', 'admin']), /free or pro/u);
});

test('builds a 30-day synthetic Pro subscription without Stripe identifiers', () => {
  const Timestamp = { fromDate: value => value };
  const now = new Date('2026-08-15T10:00:00.000Z');
  const subscription = buildSyntheticSubscription(Timestamp, now);

  assert.equal(subscription.status, 'active');
  assert.equal(subscription.role, 'pro');
  assert.equal(subscription.localSynthetic, true);
  assert.equal(subscription.current_period_start.toISOString(), '2026-08-15T10:00:00.000Z');
  assert.equal(subscription.current_period_end.toISOString(), '2026-09-14T10:00:00.000Z');
  assert.equal('stripeId' in subscription, false);
  assert.equal('customer' in subscription, false);
});
