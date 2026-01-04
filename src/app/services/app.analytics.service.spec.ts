import { TestBed } from '@angular/core/testing';
import { AppAnalyticsService } from './app.analytics.service';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { BehaviorSubject } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock Firebase Analytics logEvent
vi.mock('@angular/fire/analytics', () => ({
    Analytics: vi.fn(),
    logEvent: vi.fn(),
    setAnalyticsCollectionEnabled: vi.fn()
}));
import { setAnalyticsCollectionEnabled } from '@angular/fire/analytics';

describe('AppAnalyticsService', () => {
    let service: AppAnalyticsService;
    let mockAuthService: any;
    let userSubject: BehaviorSubject<User | null>;

    beforeEach(() => {
        vi.clearAllMocks();
        userSubject = new BehaviorSubject<User | null>(null);
        mockAuthService = {
            user$: userSubject.asObservable()
        };

        TestBed.configureTestingModule({
            providers: [
                AppAnalyticsService,
                { provide: Analytics, useValue: {} },
                { provide: AppAuthService, useValue: mockAuthService }
            ]
        });
        service = TestBed.inject(AppAnalyticsService);
    });

    afterEach(() => {
        userSubject.complete();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should NOT log event if user has not consented', () => {
        // User with no tracking consent
        userSubject.next({ acceptedTrackingPolicy: false } as User);

        service.logEvent('test_event', { param: 1 });

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

    it('should NOT log event if user is null (logged out)', () => {
        userSubject.next(null);

        service.logEvent('test_event');

        expect(logEvent).not.toHaveBeenCalled();
        expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), false);
    });
});
