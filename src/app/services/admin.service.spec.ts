import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';
import { Functions, httpsCallableFromURL } from '@angular/fire/functions';
import { environment } from '../../environments/environment';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';

// Create a mock for Cloud Functions
const mockListUsers = vi.fn();
const mockGetQueueStats = vi.fn();
const mockGetUserCount = vi.fn();
const mockImpersonateUser = vi.fn();

// Mock the Angular Fire Functions
vi.mock('@angular/fire/functions', () => ({
    Functions: vi.fn(),
    httpsCallableFromURL: vi.fn((functions, name) => {
        if (name === environment.functions.listUsers) return mockListUsers;
        if (name === environment.functions.getQueueStats) return mockGetQueueStats;
        if (name === environment.functions.getUserCount) return mockGetUserCount;
        if (name === environment.functions.impersonateUser) return mockImpersonateUser;
        return vi.fn();
    })
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getCountFromServer: vi.fn()
}));

import { Firestore } from '@angular/fire/firestore';
import { EnvironmentInjector } from '@angular/core';

describe('AdminService', () => {
    let service: AdminService;
    let functions: Functions;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AdminService,
                { provide: Functions, useValue: {} },
                { provide: Firestore, useValue: {} },
                { provide: EnvironmentInjector, useValue: { get: () => { } } }
            ]
        });
        service = TestBed.inject(AdminService);
        functions = TestBed.inject(Functions);

        // Clear mock calls
        mockListUsers.mockClear();
        mockGetQueueStats.mockClear();
        mockListUsers.mockClear();
        mockGetQueueStats.mockClear();
        mockGetUserCount.mockClear();
        mockImpersonateUser.mockClear();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should call listUsers Cloud Function and return users', async () => {
        const mockUsers = [
            { uid: '1', email: 'test@test.com', customClaims: { admin: true }, metadata: { lastSignInTime: 'now', creationTime: 'then' }, disabled: false }
        ];

        mockListUsers.mockReturnValue(Promise.resolve({ data: { users: mockUsers } }));

        const users$ = service.getUsers();
        const users = await firstValueFrom(users$);

        expect(mockListUsers).toHaveBeenCalled();
        expect(users.users).toEqual(mockUsers);
    });

    it('should call getQueueStats Cloud Function', async () => {
        const mockStats = { pending: 5, succeeded: 10, failed: 2, providers: [] };
        mockGetQueueStats.mockReturnValue(Promise.resolve({ data: mockStats }));

        const stats$ = service.getQueueStatsDirect();
        const stats = await firstValueFrom(stats$);

        expect(mockGetQueueStats).toHaveBeenCalled();
        expect(stats).toEqual(mockStats);
    });

    it('should return total user count with breakdown from Cloud Function', async () => {
        const mockData = { total: 180, pro: 50, basic: 130, free: 0, providers: {} };
        mockGetUserCount.mockReturnValue(Promise.resolve({ data: mockData }));

        const stats$ = service.getTotalUserCount();
        const stats = await firstValueFrom(stats$);

        expect(mockGetUserCount).toHaveBeenCalled();
        expect(stats).toEqual(mockData);
        expect(mockGetUserCount).toHaveBeenCalled();
        expect(stats).toEqual(mockData);
    });

    it('should call impersonateUser Cloud Function and return token', async () => {
        const mockResponse = { token: 'custom-token-123' };
        mockImpersonateUser.mockReturnValue(Promise.resolve({ data: mockResponse }));
        const uid = 'target-user-uid';

        const result$ = service.impersonateUser(uid);
        const result = await firstValueFrom(result$);

        expect(mockImpersonateUser).toHaveBeenCalledWith({ uid });
        expect(result).toEqual(mockResponse);
    });
});
