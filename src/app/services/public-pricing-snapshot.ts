import { makeStateKey } from '@angular/core';
import type { StripeProduct } from './app.payment.service';

export const PUBLIC_PRICING_SNAPSHOT_FILE_PATH = 'tmp/public-pricing-snapshot.json';

/**
 * Keeps the browser's first pricing render identical to the prerendered
 * document. The catalog is public by design, but is intentionally scoped to
 * the signed-out pricing page rather than the wider app state.
 */
export const PUBLIC_PRICING_TRANSFER_STATE_KEY = makeStateKey<StripeProduct[]>(
  'quantified-self.public-pricing-catalog.v1',
);

export interface PublicPricingSnapshot {
  version: 1;
  generatedAt: string;
  products: StripeProduct[];
}

export function parsePublicPricingSnapshot(value: unknown): PublicPricingSnapshot {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.generatedAt !== 'string'
    || Number.isNaN(Date.parse(value.generatedAt))
    || !Array.isArray(value.products)
    || value.products.length === 0
    || !value.products.every(isPublicPricingProduct)) {
    throw new Error('Public pricing snapshot has an invalid shape.');
  }

  return value as unknown as PublicPricingSnapshot;
}

function isPublicPricingProduct(value: unknown): value is StripeProduct {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.active !== 'boolean'
    || typeof value.name !== 'string'
    || (value.description !== null && typeof value.description !== 'string')
    || (value.role !== null && typeof value.role !== 'string')
    || !isStringArray(value.images)
    || !isStringRecord(value.metadata)
    || !Array.isArray(value.prices)) {
    return false;
  }

  return value.prices.every(isPublicPricingPrice);
}

function isPublicPricingPrice(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.active !== 'boolean'
    || typeof value.currency !== 'string'
    || !isSafeIntegerOrNull(value.unit_amount)
    || (value.description !== null && typeof value.description !== 'string')
    || (value.type !== 'one_time' && value.type !== 'recurring')
    || (value.interval !== null && !isRecurringInterval(value.interval))
    || !isPositiveSafeIntegerOrNull(value.interval_count)
    || !isPositiveSafeIntegerOrNull(value.trial_period_days)
    || (value.metadata !== undefined && !isStringRecord(value.metadata))) {
    return false;
  }

  if (value.recurring === null || value.recurring === undefined) {
    return true;
  }

  return isRecord(value.recurring)
    && isRecurringInterval(value.recurring.interval)
    && (value.recurring.interval_count === undefined
      || isPositiveSafeInteger(value.recurring.interval_count));
}

function isSafeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isPositiveSafeIntegerOrNull(value: unknown): value is number | null {
  return value === null || isPositiveSafeInteger(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function isRecurringInterval(value: unknown): value is 'day' | 'week' | 'month' | 'year' {
  return value === 'day' || value === 'week' || value === 'month' || value === 'year';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
