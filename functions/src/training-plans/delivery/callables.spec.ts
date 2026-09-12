import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ enforceAppCheck: vi.fn(), runtime: vi.fn() }));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('../../utils', () => ({ enforceAppCheck: mocks.enforceAppCheck }));
vi.mock('./runtime', () => ({ productionDeliveryRuntime: mocks.runtime }));
import { mutateTrainingProviderDelivery, previewTrainingProviderDelivery } from './commands';
import { TrainingScheduleMutationError } from '../mutation';

describe('Training delivery callable admission', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.enforceAppCheck.mockReset(); });
  it.each([mutateTrainingProviderDelivery, previewTrainingProviderDelivery])('requires Auth before any data access', async callable => {
    await expect((callable as unknown as (request: unknown) => Promise<unknown>)({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it.each([mutateTrainingProviderDelivery, previewTrainingProviderDelivery])('enforces App Check before parsing/authority access', async callable => {
    mocks.enforceAppCheck.mockImplementation(() => { throw new Error('App Check'); });
    await expect((callable as unknown as (request: unknown) => Promise<unknown>)({ auth: { uid: 'owner' }, data: {} })).rejects.toThrow('App Check');
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it('rejects provider authority supplied by the client', async () => {
    mocks.runtime.mockReturnValue({});
    await expect((mutateTrainingProviderDelivery as unknown as (request: unknown) => Promise<unknown>)({
      auth: { uid: 'owner' }, app: {}, data: { schemaVersion: 1, uid: 'other', remoteId: 'forged', provider: 'fake' },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('preserves the safe plan-deletion conflict instead of masking it as an internal failure', async () => {
    mocks.runtime.mockImplementationOnce(() => { throw new TrainingScheduleMutationError('failed-precondition', 'Deletion in progress.'); });
    await expect((mutateTrainingProviderDelivery as unknown as (request: unknown) => Promise<unknown>)({
      auth: { uid: 'owner' }, app: {}, data: {},
    })).rejects.toMatchObject({ code: 'failed-precondition', message: 'Deletion in progress.' });
  });
});
