import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  deletionGuard: {
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  },
  fieldDelete: Symbol('field-delete'),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldPath: {
    documentId: vi.fn(() => '__name__'),
  },
  FieldValue: {
    delete: vi.fn(() => hoisted.fieldDelete),
  },
}));

vi.mock('./service-disconnect-pending-state', () => ({
  isServiceDisconnectPendingData: (data: Record<string, unknown> | undefined) =>
    data?.disconnectState === 'disconnect_pending',
}));

vi.mock('./shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: vi.fn(async () => hoisted.deletionGuard),
  getUserDeletionGuardStateInTransaction: vi.fn(async () => hoisted.deletionGuard),
}));

import {
  classifyServiceOAuthRootForReconciliation,
  serviceOAuthRootReconciliationTestInternals,
} from './service-oauth-root-reconciliation';

interface RootHarnessOptions {
  initialData: Record<string, unknown>;
  currentData?: Record<string, unknown>;
  currentExists?: boolean;
  tokenPresent?: boolean;
}

function buildRootHarness(options: RootHarnessOptions) {
  const tokenQuery = {
    get: vi.fn(async () => ({ empty: options.tokenPresent !== true })),
  };
  const rootRef = {
    path: 'suuntoAppAccessTokens/user-1',
    collection: vi.fn(() => ({
      limit: vi.fn(() => tokenQuery),
    })),
  };
  const rootSnapshot = {
    id: 'user-1',
    ref: rootRef,
    data: () => options.initialData,
  };
  const transaction = {
    get: vi.fn(async (target: unknown) => {
      if (target === rootRef) {
        return {
          exists: options.currentExists !== false,
          data: () => options.currentData || options.initialData,
        };
      }
      if (target === tokenQuery) {
        return { empty: options.tokenPresent !== true };
      }
      throw new Error('Unexpected transaction target');
    }),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const db = {
    runTransaction: vi.fn(async (operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction)),
  };

  return { db, rootRef, rootSnapshot, tokenQuery, transaction };
}

describe('service OAuth root reconciliation', () => {
  beforeEach(() => {
    hoisted.deletionGuard.userExists = true;
    hoisted.deletionGuard.deletionInProgress = false;
    hoisted.deletionGuard.shouldSkip = false;
  });

  it('classifies active and expired OAuth attempts from the server-owned expiry', () => {
    expect(classifyServiceOAuthRootForReconciliation({
      state: 'state',
      oauthFlowGeneration: 'flow-1',
      oauthFlowExpiresAt: 2_000,
    }, 1_000).outcome).toBe('active_oauth_flow');

    expect(classifyServiceOAuthRootForReconciliation({
      state: 'state',
      oauthFlowGeneration: 'flow-1',
      oauthFlowExpiresAt: 1_000,
    }, 1_000).outcome).toBe('would_clean');
  });

  it('preserves pending disconnects and active disconnect leases', () => {
    expect(classifyServiceOAuthRootForReconciliation({
      disconnectState: 'disconnect_pending',
      disconnectOperationGeneration: 'disconnect-1',
      disconnectOperationLeaseExpiresAt: 500,
    }, 1_000).outcome).toBe('pending_disconnect');

    expect(classifyServiceOAuthRootForReconciliation({
      disconnectOperationGeneration: 'disconnect-1',
      disconnectOperationLeaseExpiresAt: 2_000,
    }, 1_000).outcome).toBe('active_disconnect_fence');

    expect(classifyServiceOAuthRootForReconciliation({
      disconnectGeneration: 'pending-generation',
      disconnectNextAttemptAt: { toMillis: () => 2_000 },
      disconnectOperationGeneration: 'disconnect-1',
      disconnectOperationLeaseExpiresAt: 500,
    }, 1_000).outcome).toBe('pending_disconnect');
  });

  it('reports legacy OAuth and disconnect state without treating it as safely expired', () => {
    expect(classifyServiceOAuthRootForReconciliation({
      state: 'legacy-state',
      oauthFlowGeneration: 'legacy-flow',
    }, 1_000).outcome).toBe('legacy_unbounded_oauth_context');

    expect(classifyServiceOAuthRootForReconciliation({
      oauthFlowGeneration: 'disconnect-flow',
      disconnectOperationGeneration: 'legacy-disconnect',
    }, 1_000).outcome).toBe('legacy_unbounded_disconnect_fence');
  });

  it('clears an expired abandoned root but retains the empty parent as an orphan-write fence', async () => {
    const harness = buildRootHarness({
      initialData: {
        state: 'state',
        codeVerifier: 'verifier',
        oauthFlowGeneration: 'flow-1',
        oauthFlowCreatedAt: 100,
        oauthFlowExpiresAt: 500,
        activeOAuthCredentialGeneration: 'flow-1',
      },
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      harness.db as never,
      harness.rootSnapshot as never,
      1_000,
      false,
    )).resolves.toBe('cleaned_fields');

    expect(harness.transaction.update).toHaveBeenCalledWith(harness.rootRef, {
      state: hoisted.fieldDelete,
      codeVerifier: hoisted.fieldDelete,
      oauthFlowGeneration: hoisted.fieldDelete,
      oauthFlowCreatedAt: hoisted.fieldDelete,
      oauthFlowExpiresAt: hoisted.fieldDelete,
      activeOAuthCredentialGeneration: hoisted.fieldDelete,
    });
    expect(harness.transaction.delete).not.toHaveBeenCalled();
  });

  it('removes expired secret-bearing fields while preserving unrelated root lifecycle data', async () => {
    const harness = buildRootHarness({
      initialData: {
        state: 'state',
        codeVerifier: 'verifier',
        oauthFlowGeneration: 'flow-1',
        oauthFlowCreatedAt: 100,
        oauthFlowExpiresAt: 500,
        retainedField: 'keep',
      },
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      harness.db as never,
      harness.rootSnapshot as never,
      1_000,
      false,
    )).resolves.toBe('cleaned_fields');

    expect(harness.transaction.update).toHaveBeenCalledWith(harness.rootRef, {
      state: hoisted.fieldDelete,
      codeVerifier: hoisted.fieldDelete,
      oauthFlowGeneration: hoisted.fieldDelete,
      oauthFlowCreatedAt: hoisted.fieldDelete,
      oauthFlowExpiresAt: hoisted.fieldDelete,
    });
    expect(harness.transaction.delete).not.toHaveBeenCalled();
  });

  it('clears an expired disconnect fence and its otherwise unowned OAuth generation', async () => {
    const harness = buildRootHarness({
      initialData: {
        oauthFlowGeneration: 'disconnect-flow',
        disconnectOperationGeneration: 'disconnect-1',
        disconnectOperationLeaseExpiresAt: 500,
      },
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      harness.db as never,
      harness.rootSnapshot as never,
      1_000,
      false,
    )).resolves.toBe('cleaned_fields');

    expect(harness.transaction.update).toHaveBeenCalledWith(harness.rootRef, {
      oauthFlowGeneration: hoisted.fieldDelete,
      disconnectOperationGeneration: hoisted.fieldDelete,
      disconnectOperationLeaseExpiresAt: hoisted.fieldDelete,
    });
    expect(harness.transaction.delete).not.toHaveBeenCalled();
  });

  it('preserves token-bearing roots even when their OAuth context is expired', async () => {
    const harness = buildRootHarness({
      initialData: {
        state: 'state',
        oauthFlowGeneration: 'flow-1',
        oauthFlowExpiresAt: 500,
      },
      tokenPresent: true,
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      harness.db as never,
      harness.rootSnapshot as never,
      1_000,
      false,
    )).resolves.toBe('token_present');

    expect(harness.transaction.delete).not.toHaveBeenCalled();
    expect(harness.transaction.update).not.toHaveBeenCalled();
  });

  it('does not clean when a newer OAuth generation wins before the transaction', async () => {
    const harness = buildRootHarness({
      initialData: {
        state: 'old-state',
        oauthFlowGeneration: 'old-flow',
        oauthFlowExpiresAt: 500,
      },
      currentData: {
        state: 'new-state',
        oauthFlowGeneration: 'new-flow',
        oauthFlowExpiresAt: 2_000,
      },
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      harness.db as never,
      harness.rootSnapshot as never,
      1_000,
      false,
    )).resolves.toBe('lifecycle_changed');

    expect(harness.transaction.delete).not.toHaveBeenCalled();
    expect(harness.transaction.update).not.toHaveBeenCalled();
  });

  it('defers cleanup to account deletion for missing or deleting users', async () => {
    hoisted.deletionGuard.deletionInProgress = true;
    hoisted.deletionGuard.shouldSkip = true;
    const harness = buildRootHarness({
      initialData: {
        state: 'state',
        oauthFlowGeneration: 'flow-1',
        oauthFlowExpiresAt: 500,
      },
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      harness.db as never,
      harness.rootSnapshot as never,
      1_000,
      false,
    )).resolves.toBe('missing_or_deleting_user');

    expect(harness.transaction.get).not.toHaveBeenCalled();
    expect(harness.transaction.delete).not.toHaveBeenCalled();
  });

  it('is idempotent when another worker already removed the candidate root', async () => {
    const harness = buildRootHarness({
      initialData: {
        state: 'state',
        oauthFlowGeneration: 'flow-1',
        oauthFlowExpiresAt: 500,
      },
      currentExists: false,
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      harness.db as never,
      harness.rootSnapshot as never,
      1_000,
      false,
    )).resolves.toBe('no_action');

    expect(harness.transaction.delete).not.toHaveBeenCalled();
    expect(harness.transaction.update).not.toHaveBeenCalled();
  });

  it('dry-runs expired and legacy candidates without opening a write transaction', async () => {
    const expired = buildRootHarness({
      initialData: {
        state: 'state',
        oauthFlowGeneration: 'flow-1',
        oauthFlowExpiresAt: 500,
      },
    });
    const legacy = buildRootHarness({
      initialData: {
        state: 'legacy-state',
        oauthFlowGeneration: 'legacy-flow',
      },
    });

    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      expired.db as never,
      expired.rootSnapshot as never,
      1_000,
      true,
    )).resolves.toBe('would_clean');
    await expect(serviceOAuthRootReconciliationTestInternals.reconcileServiceOAuthRootSnapshot(
      legacy.db as never,
      legacy.rootSnapshot as never,
      1_000,
      true,
    )).resolves.toBe('legacy_unbounded_oauth_context');

    expect(expired.db.runTransaction).not.toHaveBeenCalled();
    expect(legacy.db.runTransaction).not.toHaveBeenCalled();
  });
});
