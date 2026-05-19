import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  metaSet: vi.fn().mockResolvedValue(undefined),
  disableActivitySyncRoutesForDisconnectedService: vi.fn().mockResolvedValue(undefined),
  getUserDeletionGuardState: vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  }),
}));

vi.mock('firebase-functions/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
}));

vi.mock('./activity-sync/route-cleanup', () => ({
  disableActivitySyncRoutesForDisconnectedService: hoisted.disableActivitySyncRoutesForDisconnectedService,
}));

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            set: hoisted.metaSet,
          })),
        })),
      })),
    })),
  }), {
    FieldValue: {
      delete: vi.fn(() => 'delete-sentinel'),
    },
  });

  return {
    default: { firestore },
    firestore,
  };
});

import * as logger from 'firebase-functions/logger';
import {
  clearServiceConnectionState,
  markServiceConnected,
  markServiceReconnectRequired,
} from './service-connection-meta';

describe('service-connection-meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('writes reconnect-required state when the user deletion guard allows it', async () => {
    await markServiceReconnectRequired('user-1', ServiceNames.SuuntoApp, 'invalid_grant', 'Reconnect required', 123);

    expect(hoisted.getUserDeletionGuardState).toHaveBeenCalled();
    expect(hoisted.metaSet).toHaveBeenCalledWith({
      connectionState: 'reconnect_required',
      lastAuthFailureCode: 'invalid_grant',
      lastAuthFailureMessage: 'Reconnect required',
      lastDisconnectedAt: 123,
    }, { merge: true });
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
    );
  });

  it('does not fail reconnect-required writes when activity sync route disable fails', async () => {
    hoisted.disableActivitySyncRoutesForDisconnectedService.mockRejectedValueOnce(new Error('settings write failed'));

    await expect(markServiceReconnectRequired('user-1', ServiceNames.SuuntoApp, 'invalid_grant', 'Reconnect required', 123))
      .resolves.toBeUndefined();

    expect(hoisted.metaSet).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[ServiceConnectionMeta] Failed to disable activity sync routes for reconnect-required suuntoApp user user-1.',
      expect.any(Error),
    );
  });

  it('skips reconnect-required writes when user deletion is in progress', async () => {
    hoisted.getUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await markServiceReconnectRequired('user-1', ServiceNames.SuuntoApp, 'invalid_grant', 'Reconnect required');

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[ServiceConnectionMeta] Skipping suuntoApp meta write for user user-1 because the user is missing or deletion is in progress.',
    );
  });

  it('skips connected-state writes when the user document is missing', async () => {
    hoisted.getUserDeletionGuardState.mockResolvedValue({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    await markServiceConnected('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('skips clear-state writes when user deletion is in progress', async () => {
    hoisted.getUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await clearServiceConnectionState('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });
});
