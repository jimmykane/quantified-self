import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { AppFunctionsService } from './app.functions.service';
import { Firestore } from '@angular/fire/firestore';
import { EnvironmentInjector } from '@angular/core';

describe('AdminService', () => {
    let service: AdminService;
    let functionsServiceMock: any;

    beforeEach(() => {
        functionsServiceMock = {
            call: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                AdminService,
                { provide: AppFunctionsService, useValue: functionsServiceMock },
                { provide: Firestore, useValue: {} },
                { provide: EnvironmentInjector, useValue: { get: () => { } } }
            ]
        });
        service = TestBed.inject(AdminService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should call listUsers Cloud Function and return users', async () => {
        const mockUsers = [
            { uid: '1', email: 'test@test.com', customClaims: { admin: true }, metadata: { lastSignInTime: 'now', creationTime: 'then' }, disabled: false }
        ];

        functionsServiceMock.call.mockResolvedValue({ data: { users: mockUsers } });

        const users$ = service.getUsers();
        const users = await firstValueFrom(users$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('listUsers', expect.objectContaining({
            page: 0,
            pageSize: 25
        }));
        expect(users.users).toEqual(mockUsers);
    });

    it('should call getQueueStats Cloud Function', async () => {
        const mockStats = { pending: 5, succeeded: 10, failed: 2, providers: [] };
        functionsServiceMock.call.mockResolvedValue({ data: mockStats });

        const stats$ = service.getQueueStats();
        const stats = await firstValueFrom(stats$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getQueueStats', { includeAnalysis: true });
        expect(stats).toEqual(mockStats);
    });

    it('should return total user count with breakdown from Cloud Function', async () => {
        const mockData = { total: 180, pro: 50, basic: 130, free: 0, providers: {} };
        functionsServiceMock.call.mockResolvedValue({ data: mockData });

        const stats$ = service.getTotalUserCount();
        const stats = await firstValueFrom(stats$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getUserCount');
        expect(stats).toEqual(mockData);
    });

    it('should call impersonateUser Cloud Function and return token', async () => {
        const mockResponse = { token: 'custom-token-123' };
        functionsServiceMock.call.mockResolvedValue({ data: mockResponse });
        const uid = 'target-user-uid';

        const result$ = service.impersonateUser(uid);
        const result = await firstValueFrom(result$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('impersonateUser', { uid });
        expect(result).toEqual(mockResponse);
    });
});
