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

    it('should log compare tool entry and sign-in analytics', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logToolCompareEntry('side_nav', true);
        service.logToolCompareSignIn('guest_create', 'compare');

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'tool_compare_entry', {
            source: 'side_nav',
            signed_in: true,
        });
        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'tool_compare_sign_in', {
            source: 'guest_create',
            destination: 'compare',
        });
    });

    it('should log compare file selection analytics without raw file names', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logToolCompareFileSelection({
            selectedCount: 4,
            acceptedCount: 3,
            rejectedCount: 1,
            fileCountAfterSelection: 3,
            fileTypes: ['gpx', 'fit', 'fit'],
            compressedCount: 1,
            limitReached: false,
        });

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'tool_compare_file_selection', {
            selected_count: 4,
            accepted_count: 3,
            rejected_count: 1,
            file_count_after_selection: 3,
            file_types: 'fit|gpx',
            compressed_count: 1,
            limit_reached: false,
        });
    });

    it('should log compare create and saved table actions with compact params', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logToolCompareCreate('success', {
            fileCount: 2,
            hasCustomTitle: true,
            alreadyExists: false,
        });
        service.logToolCompareSavedAction('sort', {
            sortColumn: 'distance',
            sortDirection: 'desc',
            filterActive: true,
            resultCount: 12,
        });

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'tool_compare_create', {
            status: 'success',
            file_count: 2,
            has_custom_title: true,
            already_exists: false,
        });
        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'tool_compare_saved_action', {
            action: 'sort',
            sort_column: 'distance',
            sort_direction: 'desc',
            filter_active: true,
            result_count: 12,
        });
    });

    it('should log route upload and saved route analytics with compact params', () => {
        userSubject.next({ acceptedTrackingPolicy: true } as User);

        service.logRouteUpload('success', {
            fileType: 'gpx',
            storedFileType: 'gpx.gz',
            compressed: true,
            uploadLimit: 10,
            uploadCountAfterWrite: 4,
        });
        service.logRouteUploadBatch({
            totalFiles: 3,
            successfulUploads: 1,
            duplicateUploads: 1,
            failedUploads: 1,
        });
        service.logSavedRouteAction('download', {
            status: 'success',
            routeCount: null,
            fileCount: 1,
            fileType: 'gpx',
            zipped: false,
        });
        service.logSavedRouteAction('sort', {
            sortColumn: 'distance',
            sortDirection: 'asc',
            filterActive: true,
            resultCount: 4,
        });

        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'route_upload', {
            status: 'success',
            file_type: 'gpx',
            stored_file_type: 'gpx.gz',
            compressed: true,
            upload_limit: 10,
            upload_count_after_write: 4,
        });
        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'route_upload_batch', {
            total_files: 3,
            successful_uploads: 1,
            duplicate_uploads: 1,
            failed_uploads: 1,
        });
        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'saved_route_action', {
            action: 'download',
            status: 'success',
            file_count: 1,
            file_type: 'gpx',
            zipped: false,
        });
        expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'saved_route_action', {
            action: 'sort',
            sort_column: 'distance',
            sort_direction: 'asc',
            filter_active: true,
            result_count: 4,
        });
    });
});
