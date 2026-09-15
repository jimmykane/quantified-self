import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onDocumentWritten: vi.fn((options: unknown, handler: unknown) => ({ options, handler })),
}));

vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: mocks.onDocumentWritten }));
vi.mock('../../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: vi.fn() }));
vi.mock('./marker', () => ({ stageTrainingDeliveryReconciliation: vi.fn() }));
vi.mock('./runtime', () => ({
  DELIVERY_SERVICES: {},
  productionDeliveryRuntime: vi.fn(),
}));
vi.mock('./contracts', () => ({ DELIVERY_STATE: 'trainingDeliveryState' }));

import './lifecycle';

describe('Training delivery lifecycle triggers', () => {
  it('allocates 512 MiB to the connection and entitlement reconciliation triggers', () => {
    expect(mocks.onDocumentWritten).toHaveBeenCalledWith(expect.objectContaining({
      document: 'users/{uid}/meta/{service}',
      region: 'europe-west2',
      memory: '512MiB',
      retry: true,
    }), expect.any(Function));
    expect(mocks.onDocumentWritten).toHaveBeenCalledWith(expect.objectContaining({
      document: 'users/{uid}/system/status',
      region: 'europe-west2',
      memory: '512MiB',
      retry: true,
    }), expect.any(Function));
  });
});
