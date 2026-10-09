import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_DELIVERY_SYNC_ROUTES } from '../../../shared/route-delivery-sync-routes';
import { recordRouteOriginalCleanup, recordRouteQueueAttempt, recordRouteQueueCommit, recordRouteQueueCompletion, recordRouteQueueDispatch, recordRouteQueueRetry, routeQueueFields, routeQueueLane } from './monitoring';
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
vi.unmock('@sports-alliance/sports-lib');
const item = { ...ROUTE_DELIVERY_SYNC_ROUTES.SuuntoApp_to_WahooAPI, routeId: 'SuuntoApp_to_WahooAPI',
    ref: { parent: { id: 'routeDeliverySyncQueue' } }, userID: 'PRIVATE', savedRouteID: 'PRIVATE', errors: ['PRIVATE'], geometry: 'PRIVATE' };
describe('route queue telemetry', () => {
    beforeEach(() => vi.clearAllMocks());
    it.each(Object.values(ROUTE_DELIVERY_SYNC_ROUTES))('uses registered labels for $id', route => {
        expect(routeQueueFields('delivery', { ...route, routeId: route.id, manual: true })).toMatchObject({ source: 'suunto', mode: 'manual' });
        expect(Object.values(routeQueueFields('delivery', { ...route, routeId: route.id }))).not.toContain('unknown');
    });
    it('keeps imported routes separate from outgoing copies and rejects arbitrary labels', () => {
        expect(routeQueueFields('import', { sourceServiceName: ServiceNames.SuuntoApp })).toEqual({ lane: 'import', source: 'suunto', destination: 'qs', mode: 'automatic' });
        for (const routeId of ['PRIVATE', 'constructor', '__proto__']) expect(routeQueueFields('delivery', { ...item, routeId }).destination).toBe('unknown');
        expect(routeQueueFields('delivery', null).destination).toBe('unknown');
        expect(routeQueueFields('delivery', { ...item, destinationServiceName: 'PRIVATE', manual: 'PRIVATE' })).toMatchObject({ destination: 'unknown', mode: 'unknown' });
        expect(routeQueueLane(item)).toBe('delivery');
    });
    it('never interprets ACK, deferral or an unrelated queue as committed route success', () => {
        for (const resultStatus of [undefined, 'deferred', 'manual_reconciliation_required']) recordRouteQueueCompletion(item, { resultStatus });
        recordRouteQueueCompletion({ ...item, ref: { parent: { id: 'activitySyncQueue' } } }, { resultStatus: 'success' });
        expect(logger.info).not.toHaveBeenCalled();
        recordRouteQueueCompletion(item, { resultStatus: 'success' });
        recordRouteQueueCompletion(item, { resultStatus: 'skipped' });
        expect(vi.mocked(logger.info).mock.calls.map(([, fields]) => fields.outcome)).toEqual(['success', 'skipped']);
    });
    it('observes contention separately and emits no identity, payload or raw errors', () => {
        recordRouteQueueRetry(item, Object.assign(new Error('PRIVATE'), { name: 'ProviderOperationStillInFlightError' }));
        recordRouteQueueRetry(item, new Error('PRIVATE'));
        recordRouteQueueCommit(item, 'manual_reconciliation');
        recordRouteQueueAttempt('delivery', item, 'acknowledged', 1.8);
        recordRouteQueueDispatch('import', 'failed');
        recordRouteOriginalCleanup('failed', 'storage_delete');
        expect(vi.mocked(logger.info).mock.calls.slice(0, 2).map(([, fields]) => fields.outcome)).toEqual(['expected_contention', 'retry']);
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
        expect(logger.info).toHaveBeenCalledWith('[RouteQueue]', expect.objectContaining({ durationMs: 1 }));
    });
    it('cannot turn committed work into a retry when logging fails', () => {
        vi.mocked(logger.info).mockImplementation(() => { throw new Error('logger unavailable'); });
        expect(() => recordRouteQueueCommit(item, 'success')).not.toThrow();
        expect(() => recordRouteOriginalCleanup('deleted', 'intent_delete')).not.toThrow();
        vi.mocked(logger.info).mockReset();
    });
});
