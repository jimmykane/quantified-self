import { TestBed } from '@angular/core/testing';
import { AppAnalyticsService } from './app.analytics.service';
import { Analytics } from 'app/firebase/analytics';
import { logEvent, setAnalyticsCollectionEnabled } from 'firebase/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { BehaviorSubject } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoggerService } from './logger.service';

// Mock firebase/analytics (not app/firebase/analytics)
vi.mock('firebase/analytics', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        logEvent: vi.fn(),
        setAnalyticsCollectionEnabled: vi.fn()
    };
});

// Mock environment
vi.mock('../../environments/environment', () => ({
    environment: {
        forceAnalyticsCollection: false
    }
}));

import { environment } from '../../environments/environment';

describe('AppAnalyticsService', () => {
    let service: AppAnalyticsService;
    let mockAuthService: any;
    let userSubject: BehaviorSubject<User | null>;
    let mockLogger: any;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        userSubject = new BehaviorSubject<User | null>(null);
        mockAuthService = {
            user$: userSubject.asObservable()
        };
        mockLogger = {
            warn: vi.fn(),
            error: vi.fn(),
            log: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                AppAnalyticsService,
                { provide: Analytics, useValue: {} },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: LoggerService, useValue: mockLogger }
            ]
        });
        service = TestBed.inject(AppAnalyticsService);
    });

    afterEach(() => {
        userSubject.complete();
        localStorage.clear();
        (environment as any).forceAnalyticsCollection = false;
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should NOT log event if user has not consented and forceAnalyticsCollection is FALSE', () => {
        (environment as any).forceAnalyticsCollection = false;
        // User with no tracking consent
        userSubject.next({ acceptedTrackingPolicy: false } as User);

        service.logEvent('test_event', { param: 1 });

        // Expectation: should NOT log event
        expect(logEvent).not.toHaveBeenCalled();
        expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('should log event if user HAS consented', () => {
        // User with tracking consent
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logEvent('test_event', { param: 1 });

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'test_event', { param: 1 });
        expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), true);
    });

    it('should NOT log event if user is null (logged out) and forceAnalyticsCollection is FALSE', () => {
        (environment as any).forceAnalyticsCollection = false;
        userSubject.next(null);

        service.logEvent('test_event');

        expect(logEvent).not.toHaveBeenCalled();
        expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('should log event if forceAnalyticsCollection is TRUE, regardless of user consent', () => {
        (environment as any).forceAnalyticsCollection = true;

        // Force recreate service with new environment
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                AppAnalyticsService,
                { provide: Analytics, useValue: {} },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: LoggerService, useValue: mockLogger }
            ]
        });
        const forceService = TestBed.inject(AppAnalyticsService);

        // User with NO consent
        userSubject.next({ acceptedTrackingPolicy: false } as User);

        forceService.logEvent('test_event', { param: 1 });

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'test_event', { param: 1 });
        expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), true);
    });

    it('should log route metadata when toggling an activity sync route', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logActivitySyncRouteToggle('GarminAPI_to_SuuntoApp', true);

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'activity_sync_route_toggle', {
            route_id: 'GarminAPI_to_SuuntoApp',
            source_service: 'Garmin API',
            destination_service: 'Suunto app',
            enabled: true,
            action: 'enable',
        });
    });

    it('should log the official GA4 purchase event with checkout metadata', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logPurchase({
            transactionId: 'cs_test_123',
            role: 'pro',
            mode: 'subscription',
            priceId: 'price_pro_monthly',
            currency: 'eur',
            value: 9.99,
        });

        expect(logEvent).toHaveBeenCalledTimes(1);
        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'purchase', {
            transaction_id: 'cs_test_123',
            currency: 'EUR',
            value: 9.99,
            items: [{
                item_id: 'price_pro_monthly',
                item_name: 'pro subscription',
                item_category: 'subscription',
                item_variant: 'pro',
                quantity: 1,
                price: 9.99,
            }]
        });
    });

    it('should preserve payment mode for one-time checkout purchases', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logPurchase({ transactionId: 'cs_one_time_123', role: null, mode: 'payment' });

        expect(logEvent).toHaveBeenCalledTimes(1);
        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'purchase', {
            transaction_id: 'cs_one_time_123',
            items: [{
                item_id: 'cs_one_time_123',
                item_name: 'Subscription',
                item_category: 'payment',
                quantity: 1,
            }]
        });
    });

    it('should not log purchase when transaction id is empty', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logPurchase({ transactionId: '   ', role: 'pro', mode: 'subscription' });

        expect(logEvent).not.toHaveBeenCalled();
    });

    it('should log summary metadata when running an activity sync route backfill', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logActivitySyncRouteBackfill('GarminAPI_to_SuuntoApp', {
            scanned: 12,
            queued: 9,
            failedCount: 1,
        });

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'activity_sync_route_backfill', {
            route_id: 'GarminAPI_to_SuuntoApp',
            source_service: 'Garmin API',
            destination_service: 'Suunto app',
            scanned_count: 12,
            queued_count: 9,
            failed_count: 1,
        });
    });
});
