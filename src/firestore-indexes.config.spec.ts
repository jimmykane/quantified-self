import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface FieldOverride {
  collectionGroup: string;
  fieldPath: string;
  ttl?: boolean;
  indexes?: unknown[];
}

describe('Workout library Firestore retention', () => {
  it('expires private mutation receipts but keeps deleted-ID tombstones durable', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../firestore.indexes.json'), 'utf8')) as {
      fieldOverrides: FieldOverride[];
    };

    for (const collectionGroup of ['workoutLibraryMutationReceipts', 'workoutLibraryPlacementReceipts']) {
      expect(config.fieldOverrides.filter(override => override.collectionGroup === collectionGroup)).toEqual([{
        collectionGroup,
        fieldPath: 'expireAt',
        ttl: true,
        indexes: [],
      }]);
    }
    expect(config.fieldOverrides.some(override => override.collectionGroup === 'workoutLibraryTombstones'
      && override.ttl === true)).toBe(false);
  });
});
