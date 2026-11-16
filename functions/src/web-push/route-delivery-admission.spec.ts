import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { beginManualRouteSendNotification, finishManualRouteSendNotification, withManualRouteUploadNotification } from './route-delivery-admission';
import { beginRouteDeliveryNotification, completeRouteDeliveryNotification } from './route-delivery-service';
import type { SendRoutesToServiceResponse } from '../../../shared/saved-route-send';
const mocks = vi.hoisted(() => ({ template: vi.fn(), log: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: mocks.template }) }));
vi.mock('firebase-functions/logger', () => ({ error: mocks.log }));
vi.mock('./route-delivery-service', () => ({ beginRouteDeliveryNotification: vi.fn(), completeRouteDeliveryNotification: vi.fn() }));
const id = '00000000-0000-4000-8000-000000000001', origin = 'https://beta.quantified-self.io';
const notification = { requestId: id, createdAtMs: 1, totalRoutes: 1, chunkIndex: 0 };
const payload = { routeIds: ['route'], destinationServiceName: ServiceNames.GarminAPI, notification };
const ticket = { uid: 'owner', id, index: 0, hash: 'hash' };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(beginRouteDeliveryNotification).mockResolvedValue(ticket); vi.mocked(completeRouteDeliveryNotification).mockResolvedValue(); });
afterEach(() => vi.useRealTimers());
describe('manual-only route notification boundaries', () => {
  it.each(['missing metadata', 'malformed', 'impersonation', 'unknown site'])('does not admit %s', async reason => {
    await expect(beginManualRouteSendNotification('owner', { ...payload,
      notification: reason === 'missing metadata' ? undefined : reason === 'malformed' ? {} as never : notification },
    reason === 'unknown site' ? 'https://example.com' : origin, reason === 'impersonation' ? 'admin' : undefined)).resolves.toBeUndefined();
    expect(beginRouteDeliveryNotification).not.toHaveBeenCalled();
  });
  it('binds the authenticated owner and server route chunk without caller-provided result counts', async () => {
    await expect(beginManualRouteSendNotification('owner', payload, origin, undefined)).resolves.toEqual(ticket);
    expect(beginRouteDeliveryNotification).toHaveBeenCalledWith('owner', ServiceNames.GarminAPI, notification, ['route'], false, expect.any(Object));
  });
  it('bounds stalled configuration and logs no raw errors', async () => {
    vi.useFakeTimers(); mocks.template.mockReturnValue(new Promise(() => {}));
    vi.mocked(beginRouteDeliveryNotification).mockImplementation(async (_uid, _service, _notification, _routes, _force, deps) => {
      await deps.configuration(); return ticket;
    });
    const pending = beginManualRouteSendNotification('owner', payload, origin, undefined);
    await vi.advanceTimersByTimeAsync(5000); await expect(pending).resolves.toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
    expect(mocks.log).toHaveBeenCalledWith('[RouteDeliveryPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
  });
  it('notification persistence failure never changes the primary route result', async () => {
    vi.mocked(completeRouteDeliveryNotification).mockRejectedValue(new Error('private-canary'));
    await expect(finishManualRouteSendNotification(ticket, {} as SendRoutesToServiceResponse, 1)).resolves.toBeUndefined();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-canary');
  });
  it.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI])('wraps explicit file uploads to %s without storing their names or payloads', async service => {
    const upload = vi.fn(async () => ({ status: 'success', providerRouteId: 'private-provider' }));
    const result = await withManualRouteUploadNotification({ uid: 'owner', service, origin, impersonatedBy: undefined,
      data: { file: 'private-base64-canary', filename: 'private-name', notification } }, upload);
    expect(result).toEqual({ status: 'success', providerRouteId: 'private-provider' }); expect(upload).toHaveBeenCalledOnce();
    expect(completeRouteDeliveryNotification).toHaveBeenCalledWith(ticket, expect.objectContaining({ successCount: 1, routeCount: 1 }), 1, expect.any(Object));
    expect(JSON.stringify(vi.mocked(beginRouteDeliveryNotification).mock.calls)).not.toMatch(/private-base64|private-name/);
  });
  it('retains the original upload error even if notification completion fails', async () => {
    vi.mocked(completeRouteDeliveryNotification).mockRejectedValue(new Error('private-notification-error'));
    const error = new Error('original-provider-error');
    await expect(withManualRouteUploadNotification({ uid: 'owner', service: ServiceNames.GarminAPI, origin, impersonatedBy: undefined,
      data: { file: 'data', notification } }, async () => { throw error; })).rejects.toBe(error);
    expect(completeRouteDeliveryNotification).toHaveBeenCalledWith(ticket, expect.objectContaining({ failureCount: 1 }), 0, expect.any(Object));
  });
});
