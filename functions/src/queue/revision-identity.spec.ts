import { describe, expect, it } from 'vitest';

import {
  getQueueRevisionIdentity,
  hasMatchingQueueRevision,
  isCurrentQueueRevision,
  normalizeQueueRevision,
} from './revision-identity';

describe('queue revision identity', () => {
  it('normalizes explicit revisions and falls back to a supplied legacy identity', () => {
    expect(normalizeQueueRevision(' revision-1 ')).toBe('revision-1');
    expect(normalizeQueueRevision('   ')).toBeNull();
    expect(normalizeQueueRevision(123)).toBeNull();
    expect(getQueueRevisionIdentity({ queueRevision: ' revision-1 ' }, 'legacy:item'))
      .toBe('revision:revision-1');
    expect(getQueueRevisionIdentity({}, 'legacy:item')).toBe('legacy:item');
    expect(getQueueRevisionIdentity({}, '   ')).toBeNull();
    expect(getQueueRevisionIdentity({})).toBeNull();
  });

  it('matches explicit revisions without allowing a legacy match to override them', () => {
    expect(hasMatchingQueueRevision({
      currentQueueItem: { queueRevision: ' revision-1 ' },
      attemptedQueueItem: { queueRevision: 'revision-1' },
      legacyIdentityMatches: false,
    })).toBe(true);
    expect(hasMatchingQueueRevision({
      currentQueueItem: { queueRevision: 'revision-2' },
      attemptedQueueItem: { queueRevision: 'revision-1' },
      legacyIdentityMatches: true,
    })).toBe(false);
    expect(hasMatchingQueueRevision({
      currentQueueItem: {},
      attemptedQueueItem: { queueRevision: 'revision-1' },
      legacyIdentityMatches: true,
    })).toBe(false);
  });

  it('uses legacy identity only when neither item has an explicit revision', () => {
    expect(hasMatchingQueueRevision({
      currentQueueItem: {},
      attemptedQueueItem: {},
      legacyIdentityMatches: true,
    })).toBe(true);
    expect(hasMatchingQueueRevision({
      currentQueueItem: {},
      attemptedQueueItem: {},
      legacyIdentityMatches: false,
    })).toBe(false);
    expect(hasMatchingQueueRevision({
      currentQueueItem: { queueRevision: 'revision-2' },
      attemptedQueueItem: {},
      legacyIdentityMatches: true,
    })).toBe(false);
  });

  it('rejects a processed item even when its revision matches', () => {
    expect(isCurrentQueueRevision({
      currentQueueItem: { queueRevision: 'revision-1', processed: false },
      attemptedQueueItem: { queueRevision: 'revision-1' },
      legacyIdentityMatches: false,
    })).toBe(true);
    expect(isCurrentQueueRevision({
      currentQueueItem: { queueRevision: 'revision-1', processed: true },
      attemptedQueueItem: { queueRevision: 'revision-1' },
      legacyIdentityMatches: false,
    })).toBe(false);
  });
});
