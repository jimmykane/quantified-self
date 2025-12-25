import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';
import { Functions, httpsCallableFromURL } from '@angular/fire/functions';
import { environment } from '../../environments/environment';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';

// Create a mock for listUsers function
const mockListUsers = vi.fn();

// Mock the Angular Fire Functions
vi.mock('@angular/fire/functions', () => ({
    Functions: vi.fn(),
    httpsCallableFromURL: vi.fn(() => mockListUsers)
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getCountFromServer: vi.fn()
}));

import { Firestore, collection, getCountFromServer } from '@angular/fire/firestore';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';

describe('AdminService', () => {
    let service: AdminService;
    let functions: Functions;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AdminService,
                { provide: Functions, useValue: {} },
                { provide: Firestore, useValue: {} },
                { provide: EnvironmentInjector, useValue: { get: () => { } } } // Mock injector
            ]
        });
        service = TestBed.inject(AdminService);
        functions = TestBed.inject(Functions);

        // Clear mock calls
        mockListUsers.mockClear();
        vi.mocked(collection).mockClear();
        vi.mocked(getCountFromServer).mockClear();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should call listUsers Cloud Function and return users', async () => {
        const mockUsers = [
            { uid: '1', email: 'test@test.com', customClaims: { admin: true }, metadata: { lastSignInTime: 'now', creationTime: 'then' }, disabled: false }
        ];

        // Mock the return value of the cloud function call
        mockListUsers.mockReturnValue(Promise.resolve({ data: { users: mockUsers } }));

        const users$ = service.getUsers();
        const users = await firstValueFrom(users$);

        expect(httpsCallableFromURL).toHaveBeenCalledWith(functions, environment.functions.listUsers);
        expect(mockListUsers).toHaveBeenCalled();
        expect(users.users).toEqual(mockUsers);
    });

    it('should aggregate queue stats by provider', async () => {
        // Mock getCountFromServer to return different values based on calls
        // We have 5 collections * 3 queries each = 15 calls
        // 1. Suunto x2 (pending/success/failed)
        // 2. COROS x2
        // 3. Garmin x1

        vi.mocked(getCountFromServer).mockResolvedValue({ data: () => ({ count: 1 }) } as any);

        // We need to run inside injection context because of runInInjectionContext usage
        await TestBed.runInInjectionContext(async () => {
            const stats$ = service.getQueueStatsDirect();
            const stats = await firstValueFrom(stats$);

            // 5 collections * 1 pending each = 5
            expect(stats.pending).toBe(5);
            expect(stats.succeeded).toBe(5);
            expect(stats.failed).toBe(5);

            expect(stats.providers.length).toBe(3);
            const suuntoCallback = stats.providers.find(p => p.name === 'Suunto');
            expect(suuntoCallback?.pending).toBe(2); // 2 collections

            const corosCallback = stats.providers.find(p => p.name === 'COROS');
            expect(corosCallback?.pending).toBe(2); // 2 collections

            const garminCallback = stats.providers.find(p => p.name === 'Garmin');
            expect(garminCallback?.pending).toBe(1); // 1 collection
        });
    });
});
