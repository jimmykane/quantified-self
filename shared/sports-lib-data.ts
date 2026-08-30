import type { DataJSONInterface } from '@sports-alliance/sports-lib';

export const SPORTS_LIB_DATA_SCHEMA_VERSION = 1 as const;

/**
 * Versioned storage boundary for canonical Sports Lib scalar JSON. Quantified
 * Self continues to own the surrounding record/session envelope.
 */
export interface SportsLibDataEnvelope<TKey extends string = string> {
  schemaVersion: typeof SPORTS_LIB_DATA_SCHEMA_VERSION;
  metrics: Partial<Record<TKey, DataJSONInterface>>;
}
