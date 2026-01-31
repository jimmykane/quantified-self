import { TestBed } from '@angular/core/testing';
import { AppAnalyticsService } from './app.analytics.service';
import { Analytics } from '@angular/fire/analytics';
import { logEvent, setAnalyticsCollectionEnabled } from 'firebase/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { BehaviorSubject } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoggerService } from './logger.service';

// Mock firebase/analytics (not @angular/fire/analytics)
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
});
