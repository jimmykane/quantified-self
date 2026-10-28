import type Stripe from 'stripe';

/** Recheck the customer deletion fence before every independent provider call.
 * SDK-internal transport retries retain their original idempotency key. */
export function guardedBillingStripe(stripe: Stripe, beforeCall: () => Promise<void>): Stripe {
  const wrap = (value: object): object => new Proxy(value, {
    get(target, property) {
      const member = Reflect.get(target, property);
      if (typeof member === 'function') return async (...args: unknown[]) => {
        await beforeCall();
        return Reflect.apply(member, target, args);
      };
      return member && typeof member === 'object' ? wrap(member) : member;
    },
  });
  return wrap(stripe) as Stripe;
}
