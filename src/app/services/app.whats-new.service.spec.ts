import { TestBed } from '@angular/core/testing';
import { AppWhatsNewService, ChangelogPost } from './app.whats-new.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserService } from './app.user.service';
import { Firestore, collectionData, Timestamp } from '@angular/fire/firestore';
import { LoggerService } from './logger.service';
import { of, BehaviorSubject } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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
    const flushSignals = async () => {
        await Promise.resolve();
        await Promise.resolve();
    };

    beforeEach(() => {
        userSubject.next(null);
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

    it('markAsRead should persist lastSeenChangelogDate in app settings for authenticated users', async () => {
        const user = { uid: '123', settings: { appSettings: {} } };
        service = TestBed.inject(AppWhatsNewService);

        userSubject.next(user);
        await service.markAsRead();

        expect(userServiceMock.updateUserProperties).toHaveBeenCalledWith(user, {
            settings: {
                appSettings: {
                    lastSeenChangelogDate: expect.any(Date)
                }
            }
        });
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

    it('should not mark changelogs before account creation as unread for first-time users', async () => {
        const mockPost = {
            id: '1',
            title: 'Release 1.0',
            description: 'First release',
            date: new Date('2026-01-10T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;

        service = TestBed.inject(AppWhatsNewService);

        userSubject.next({
            uid: '123',
            creationDate: new Date('2026-02-01T00:00:00Z'),
            settings: { appSettings: {} }
        });
        await flushSignals();

        expect(service.isUnread(mockPost)).toBe(false);
    });

    it('should still mark changelogs after account creation as unread for first-time users', async () => {
        const mockPost = {
            id: '1',
            title: 'Release 1.1',
            description: 'New feature',
            date: new Date('2026-03-01T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;

        service = TestBed.inject(AppWhatsNewService);

        userSubject.next({
            uid: '123',
            creationDate: new Date('2026-02-01T00:00:00Z'),
            settings: { appSettings: {} }
        });
        await flushSignals();

        expect(service.isUnread(mockPost)).toBe(true);
    });

    it('should prefer an explicit lastSeenChangelogDate over creationDate', async () => {
        const olderPost = {
            id: '1',
            title: 'Release 1.1',
            description: 'Older release',
            date: new Date('2026-03-01T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;
        const newerPost = {
            id: '2',
            title: 'Release 1.2',
            description: 'Newer release',
            date: new Date('2026-03-10T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;

        service = TestBed.inject(AppWhatsNewService);

        userSubject.next({
            uid: '123',
            creationDate: new Date('2026-02-01T00:00:00Z'),
            settings: {
                appSettings: {
                    lastSeenChangelogDate: { seconds: Date.parse('2026-03-05T00:00:00Z') / 1000 }
                }
            }
        });
        await flushSignals();

        expect(service.isUnread(olderPost)).toBe(false);
        expect(service.isUnread(newerPost)).toBe(true);
    });

    it('should fall back to creationDate when stored lastSeenChangelogDate is invalid', async () => {
        const beforeCreationPost = {
            id: '1',
            title: 'Release 1.0',
            description: 'Before signup',
            date: new Date('2026-01-15T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;
        const afterCreationPost = {
            id: '2',
            title: 'Release 1.1',
            description: 'After signup',
            date: new Date('2026-02-15T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;

        service = TestBed.inject(AppWhatsNewService);

        userSubject.next({
            uid: '123',
            creationDate: new Date('2026-02-01T00:00:00Z'),
            settings: {
                appSettings: {
                    lastSeenChangelogDate: 'not-a-date'
                }
            }
        });
        await flushSignals();

        expect(service.isUnread(beforeCreationPost)).toBe(false);
        expect(service.isUnread(afterCreationPost)).toBe(true);
    });

    it('should evaluate multiple changelogs consistently against the explicit lastSeenChangelogDate', async () => {
        const seenPost = {
            id: '1',
            title: 'Release 1.0',
            description: 'Already seen',
            date: new Date('2026-02-01T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;
        const firstUnreadPost = {
            id: '2',
            title: 'Release 1.1',
            description: 'Unread',
            date: new Date('2026-02-20T00:00:00Z'),
            published: true,
            type: 'minor'
        } as ChangelogPost;
        const secondUnreadPost = {
            id: '3',
            title: 'Release 1.2',
            description: 'Unread',
            date: new Date('2026-03-01T00:00:00Z'),
            published: true,
            type: 'major'
        } as ChangelogPost;

        service = TestBed.inject(AppWhatsNewService);

        userSubject.next({
            uid: '123',
            creationDate: new Date('2026-01-01T00:00:00Z'),
            settings: {
                appSettings: {
                    lastSeenChangelogDate: '2026-02-15T00:00:00Z'
                }
            }
        });
        await flushSignals();

        expect(service.isUnread(seenPost)).toBe(false);
        expect(service.isUnread(firstUnreadPost)).toBe(true);
        expect(service.isUnread(secondUnreadPost)).toBe(true);
    });
});
