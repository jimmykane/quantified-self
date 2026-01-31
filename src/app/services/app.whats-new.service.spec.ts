import { TestBed } from '@angular/core/testing';
import { AppWhatsNewService } from './app.whats-new.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserService } from './app.user.service';
import { Firestore } from '@angular/fire/firestore';
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

    beforeEach(() => {
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
        service = TestBed.inject(AppWhatsNewService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('markAsRead should call updateUserProperties for authenticated user', async () => {
        userSubject.next({ uid: '123' });
        await service.markAsRead();
        expect(userServiceMock.updateUserProperties).toHaveBeenCalled();
    });

    it('markAsRead should call localStorage for guest user', async () => {
        userSubject.next(null);
        await service.markAsRead();
        expect(userServiceMock.updateUserProperties).not.toHaveBeenCalled();
        expect(localStorageMock.setItem).toHaveBeenCalledWith('whats_new_last_seen', expect.any(String));
    });
});
