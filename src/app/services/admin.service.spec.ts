
import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';
import { Functions } from '@angular/fire/functions';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';

// Mock httpsCallable
const mockHttpsCallable = vi.fn();
vi.mock('@angular/fire/functions', async (importOriginal) => {
    const original: any = await importOriginal();
    return {
        ...original,
        httpsCallable: () => mockHttpsCallable
    };
});

describe('AdminService', () => {
    let service: AdminService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AdminService,
                { provide: Functions, useValue: {} }
            ]
        });
        service = TestBed.inject(AdminService);
    });

    it('should fetch users from Cloud Function', async () => {
        const mockUsers = [
            { uid: 'user1', email: 'user1@example.com', customClaims: {} }
        ];

        mockHttpsCallable.mockResolvedValue({
            data: { users: mockUsers }
        });

        const users$ = service.getUsers();
        const users = await firstValueFrom(users$);

        expect(users).toEqual(mockUsers);
        expect(mockHttpsCallable).toHaveBeenCalled();
    });

    it('should propagate errors from Cloud Function', async () => {
        mockHttpsCallable.mockRejectedValue(new Error('Function error'));

        await expect(firstValueFrom(service.getUsers())).rejects.toThrow('Function error');
    });
});
