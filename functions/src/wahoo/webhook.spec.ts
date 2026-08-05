import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  const tokenQueryGet = vi.fn();
  const limit = vi.fn(() => ({ get: tokenQueryGet }));
  const serviceWhere = vi.fn(() => ({ limit }));
  const userWhere = vi.fn(() => ({ where: serviceWhere }));
  const collectionGroup = vi.fn(() => ({ where: userWhere }));
  return {
    tokenQueryGet,
    limit,
    serviceWhere,
    userWhere,
    collectionGroup,
    deletionGuard: vi.fn(),
    disconnectPending: vi.fn(),
    hasProAccess: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({ collectionGroup: mocks.collectionGroup }),
}));
vi.mock('../utils', () => ({
  generateIDFromParts: vi.fn(),
  hasProAccess: mocks.hasProAccess,
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mocks.deletionGuard,
}));
vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: mocks.disconnectPending,
}));
vi.mock('./queue-store', () => ({ upsertWahooWorkoutQueueItem: vi.fn() }));

import { resolveActiveWahooOwner, secureTokenMatches } from './webhook';

function wahooTokenDocument(firebaseUserID: string, wahooUserID = 'wahoo-1') {
  return {
    id: wahooUserID,
    ref: {
      parent: {
        id: 'tokens',
        parent: {
          id: firebaseUserID,
          parent: { id: 'wahooAPIAccessTokens' },
        },
      },
    },
  };
}

describe('secureTokenMatches', () => {
  it('accepts only an exact webhook token', () => {
    expect(secureTokenMatches('same-secret', 'same-secret')).toBe(true);
    expect(secureTokenMatches('different-secret', 'same-secret')).toBe(false);
    expect(secureTokenMatches(undefined, 'same-secret')).toBe(false);
  });
});

describe('resolveActiveWahooOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenQueryGet.mockResolvedValue({ docs: [] });
    mocks.deletionGuard.mockResolvedValue({ shouldSkip: false });
    mocks.disconnectPending.mockResolvedValue(false);
    mocks.hasProAccess.mockResolvedValue(true);
  });

  it('resolves the sole active owner through the shared token index', async () => {
    mocks.tokenQueryGet.mockResolvedValue({ docs: [wahooTokenDocument('firebase-1')] });

    await expect(resolveActiveWahooOwner(' wahoo-1 ')).resolves.toBe('firebase-1');

    expect(mocks.collectionGroup).toHaveBeenCalledWith('tokens');
    expect(mocks.userWhere).toHaveBeenCalledWith('wahooUserID', '==', 'wahoo-1');
    expect(mocks.serviceWhere).toHaveBeenCalledWith('serviceName', '==', ServiceNames.WahooAPI);
    expect(mocks.limit).toHaveBeenCalledWith(2);
    expect(mocks.deletionGuard).toHaveBeenCalledWith(expect.anything(), 'firebase-1');
  });

  it('returns no owner when no matching Wahoo token exists', async () => {
    await expect(resolveActiveWahooOwner('wahoo-1')).resolves.toBeNull();
    expect(mocks.deletionGuard).not.toHaveBeenCalled();
  });

  it('fails closed when duplicate token owners make routing ambiguous', async () => {
    mocks.tokenQueryGet.mockResolvedValue({
      docs: [
        wahooTokenDocument('firebase-1'),
        wahooTokenDocument('firebase-2'),
      ],
    });

    await expect(resolveActiveWahooOwner('wahoo-1')).rejects.toThrow('multiple active token owners');
    expect(mocks.deletionGuard).not.toHaveBeenCalled();
  });

  it('fails closed when a matching token is outside the Wahoo token collection', async () => {
    const token = wahooTokenDocument('firebase-1');
    token.ref.parent.parent.parent.id = 'unexpectedTokenRoots';
    mocks.tokenQueryGet.mockResolvedValue({ docs: [token] });

    await expect(resolveActiveWahooOwner('wahoo-1')).rejects.toThrow('invalid token path');
  });

  it('ignores owners that are deleting, disconnecting, or no longer Pro', async () => {
    mocks.tokenQueryGet.mockResolvedValue({ docs: [wahooTokenDocument('firebase-1')] });
    mocks.deletionGuard.mockResolvedValue({ shouldSkip: true });
    await expect(resolveActiveWahooOwner('wahoo-1')).resolves.toBeNull();

    mocks.deletionGuard.mockResolvedValue({ shouldSkip: false });
    mocks.disconnectPending.mockResolvedValue(true);
    await expect(resolveActiveWahooOwner('wahoo-1')).resolves.toBeNull();

    mocks.disconnectPending.mockResolvedValue(false);
    mocks.hasProAccess.mockResolvedValue(false);
    await expect(resolveActiveWahooOwner('wahoo-1')).resolves.toBeNull();
  });
});
