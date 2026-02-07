import { TestBed } from '@angular/core/testing';
import { AppWhatsNewService, ChangelogPost } from './app.whats-new.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserService } from './app.user.service';
import { Firestore, collectionData, Timestamp } from '@angular/fire/firestore';
import { LoggerService } from './logger.service';
import { of, BehaviorSubject } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { AppLocalStorageService } from './storage/app.local.storage.service'; // Keep this or remove if not needed, but we need AppWhatsNewLocalStorageService
import { AppWhatsNewLocalStorageService } from './storage/app.whats-new.local.storage.service';

// Mock Firestore functions
vi.mock('@angular/fire/firestore', () => {
    class MockFirestore { }
    class MockTimestamp {
        seconds = 0;
        toDate() { return new Date(); }
    }
    return {
        collection: vi.fn(),
        collectionData: vi.fn(() => of([])),
        query: vi.fn(),
        orderBy: vi.fn(),
        where: vi.fn(),
        Firestore: MockFirestore,
        Timestamp: MockTimestamp
    };
});

describe('AppWhatsNewService', () => {
    let service: AppWhatsNewService;
    let authServiceMock: any;
    let userServiceMock: any;
    let firestoreMock: any;
    let loggerServiceMock: any;
    let localStorageMock: any;

    const userSubject = new BehaviorSubject<any>(null);
    const collectionDataMock = vi.mocked(collectionData);

    beforeEach(() => {
        collectionDataMock.mockReturnValue(of([]));
        authServiceMock = {
            user$: userSubject.asObservable(),
            user: () => userSubject.getValue()
        };

        userServiceMock = {
            updateUserProperties: vi.fn().mockResolvedValue(true)
        };

        firestoreMock = {};

        loggerServiceMock = {
            info: vi.fn()
        };

        localStorageMock = {
            getItem: vi.fn(),
            setItem: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                AppWhatsNewService,
                { provide: AppAuthService, useValue: authServiceMock },
                { provide: AppUserService, useValue: userServiceMock },
                { provide: Firestore, useValue: firestoreMock },
                { provide: LoggerService, useValue: loggerServiceMock },
                { provide: AppWhatsNewLocalStorageService, useValue: localStorageMock }
            ]
        });
    });

    it('should be created', () => {
        service = TestBed.inject(AppWhatsNewService);
        expect(service).toBeTruthy();
    });

    it('markAsRead should call updateUserProperties for authenticated user', async () => {
        service = TestBed.inject(AppWhatsNewService);
        userSubject.next({ uid: '123' });
        await service.markAsRead();
        expect(userServiceMock.updateUserProperties).toHaveBeenCalled();
    });

    it('markAsRead should call localStorage for guest user', async () => {
        service = TestBed.inject(AppWhatsNewService);
        userSubject.next(null);
        await service.markAsRead();
        expect(userServiceMock.updateUserProperties).not.toHaveBeenCalled();
        expect(localStorageMock.setItem).toHaveBeenCalledWith('whats_new_last_seen', expect.any(String));
    });

    it('unreadCount should be 0 for guest users even with changelogs', () => {
        const mockPost: ChangelogPost = {
            id: '1',
            title: 'Release 1.0',
            description: 'First release',
            date: new Timestamp(0, 0),
            published: true,
            type: 'minor'
        };

        collectionDataMock.mockReturnValue(of([mockPost]));
        service = TestBed.inject(AppWhatsNewService);

        expect(service.unreadCount()).toBe(0);
    });
});
