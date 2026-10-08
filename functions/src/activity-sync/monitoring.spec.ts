import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, HISTORICAL_MANUAL_ACTIVITY_ROUTES } from '../../../shared/activity-sync-routes';
import { activityDeliveryFields, activityDeliveryFailureOutcome, recordActivityDeliveryAttempt, recordActivityDeliveryCommit, recordActivityDeliveryCompletion, recordActivityDeliveryDispatch, recordActivityDeliverySample } from './monitoring';
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
vi.unmock('@sports-alliance/sports-lib');
const item = { routeId: 'GarminAPI_to_WahooAPI', sourceServiceName: ServiceNames.GarminAPI, destinationServiceName: ServiceNames.WahooAPI, ref: { parent: { id: 'activitySyncQueue' } }, userID: 'PRIVATE', eventID: 'PRIVATE', destinationUploadID: 'PRIVATE', errors: ['PRIVATE'] };
describe('recorded activity delivery telemetry', () => {
    beforeEach(() => vi.clearAllMocks());
    it.each([...Object.values(ACTIVITY_SYNC_ROUTES), ...Object.values(HISTORICAL_MANUAL_ACTIVITY_ROUTES)])('covers fixed labels for $id', route => {
        const labels = activityDeliveryFields({ routeId: route.id, sourceServiceName: route.sourceServiceName, destinationServiceName: route.destinationServiceName,
            deliveryMode: (route.sourceServiceName as string) === 'manualUpload' ? 'historical' : 'automatic' });
        expect(Object.values(labels)).not.toContain('unknown');
    });
    it('normalizes automatic, historical and manual-upload routes without retaining identities', () => {
        recordActivityDeliveryAttempt(item, 'acknowledged', 1.8);
        recordActivityDeliveryCommit({ ...item, deliveryMode: 'historical' }, 'provider_pending');
        expect(activityDeliveryFields({ ...item, routeId: 'ManualUpload_to_WahooAPI', sourceServiceName: 'manualUpload', deliveryMode: 'historical' })).toEqual({ source: 'manualUpload', destination: 'wahoo', mode: 'historical' });
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
        expect(logger.info).toHaveBeenCalledWith('[ActivityDelivery]', expect.objectContaining({ event: 'worker_attempt', outcome: 'acknowledged', durationMs: 1 }));
    });
    it('rejects unknown or contradictory labels rather than copying untrusted strings', () => {
        expect(activityDeliveryFields({ ...item, destinationServiceName: 'PRIVATE', deliveryMode: 'PRIVATE' })).toEqual({ source: 'unknown', destination: 'unknown', mode: 'unknown' });
        expect(activityDeliveryFields({ ...item, routeId: 'PRIVATE' }).destination).toBe('unknown');
        expect(activityDeliveryFields({ routeId: 'constructor' }).destination).toBe('unknown');
        recordActivityDeliverySample('PRIVATE', { dueSample: 1 });
        expect(logger.info).not.toHaveBeenCalled();
    });
    it('only claims delivery for an explicit committed success; ACK, pending and skips are different', () => {
        for (const resultStatus of [undefined, 'deferred', 'manual_reconciliation_required']) recordActivityDeliveryCompletion(item, { resultStatus });
        recordActivityDeliveryCompletion({ ...item, ref: { parent: { id: 'other' } } }, { resultStatus: 'success' });
        expect(logger.info).not.toHaveBeenCalled();
        recordActivityDeliveryCompletion(item, { resultStatus: 'success' });
        recordActivityDeliveryCompletion(item, { resultStatus: 'skipped' });
        expect(vi.mocked(logger.info).mock.calls.map(([, fields]) => fields.outcome)).toEqual(['delivered', 'skipped']);
    });
    it('observes contention without exporting the exception and emits fixed idle heartbeats', () => {
        expect(activityDeliveryFailureOutcome(Object.assign(new Error('PRIVATE'), { name: 'ProviderOperationStillInFlightError' }))).toBe('expected_contention');
        expect(activityDeliveryFailureOutcome(new Error('PRIVATE'))).toBe('failed');
        recordActivityDeliveryDispatch('failed');
        recordActivityDeliverySample('coros', { dueSample: 0, ageLowerBoundMs: 0 });
        recordActivityDeliverySample('wahoo');
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
    it('cannot turn committed work into a retry when the logger fails', () => {
        vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('logger unavailable'); });
        expect(() => recordActivityDeliveryCommit(item, 'delivered')).not.toThrow();
    });
});
