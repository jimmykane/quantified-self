import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin', () => ({ firestore: vi.fn() }));
vi.mock('../utils', () => ({ generateIDFromParts: vi.fn(), hasProAccess: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardState: vi.fn() }));
vi.mock('../service-disconnect-pending', () => ({ isServiceDisconnectPendingForUser: vi.fn() }));
vi.mock('./queue-store', () => ({ upsertWahooWorkoutQueueItem: vi.fn() }));

import { secureTokenMatches } from './webhook';

describe('secureTokenMatches', () => {
  it('accepts only an exact webhook token', () => {
    expect(secureTokenMatches('same-secret', 'same-secret')).toBe(true);
    expect(secureTokenMatches('different-secret', 'same-secret')).toBe(false);
    expect(secureTokenMatches(undefined, 'same-secret')).toBe(false);
  });
});
