import { describe, expect, it } from 'vitest';

import {
  getCOROSQueueRevisionIdentity,
  isSameCOROSQueueRevision,
} from './queue-revision';

describe('COROS queue revision identity', () => {
  it('prefers an explicit revision and preserves the legacy lease identity', () => {
    expect(getCOROSQueueRevisionIdentity({
      queueRevision: ' revision-1 ',
      dateCreated: 123,
      openId: 'open-id',
    })).toBe('revision:revision-1');
    expect(getCOROSQueueRevisionIdentity({
      dateCreated: 123,
      openId: ' open-id ',
    })).toBe('legacy:123:open-id');
    expect(getCOROSQueueRevisionIdentity({ dateCreated: 123 })).toBeNull();
  });

  it('matches explicit and legacy revisions without crossing COROS accounts', () => {
    expect(isSameCOROSQueueRevision(
      { queueRevision: 'revision-1', dateCreated: 200, openId: 'open-id' },
      { queueRevision: 'revision-1', dateCreated: 100, openId: 'other-open-id' },
    )).toBe(true);
    expect(isSameCOROSQueueRevision(
      { dateCreated: 100, openId: 'open-id' },
      { dateCreated: 100, openId: 'open-id' },
    )).toBe(true);
    expect(isSameCOROSQueueRevision(
      { dateCreated: 100, openId: 'other-open-id' },
      { dateCreated: 100, openId: 'open-id' },
    )).toBe(false);
    expect(isSameCOROSQueueRevision(
      { queueRevision: 'revision-2', dateCreated: 100, openId: 'open-id' },
      { dateCreated: 100, openId: 'open-id' },
    )).toBe(false);
  });

  it('rejects a processed matching revision', () => {
    expect(isSameCOROSQueueRevision(
      { queueRevision: 'revision-1', processed: true },
      { queueRevision: 'revision-1' },
    )).toBe(false);
  });
});
