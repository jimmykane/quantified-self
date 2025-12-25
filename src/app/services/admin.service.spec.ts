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


describe('AdminService', () => {
    let service: AdminService;
    let functions: Functions;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AdminService,
                { provide: Functions, useValue: {} }
            ]
        });
        service = TestBed.inject(AdminService);
        functions = TestBed.inject(Functions);

        // Clear mock calls
        mockListUsers.mockClear();
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
        expect(users).toEqual(mockUsers);
    });
});
