import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';
import { Functions, httpsCallableFromURL } from '@angular/fire/functions';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';

// Create a mock for listUsers function
const mockListUsers = jest.fn();

// Mock the Angular Fire Functions
// We need to mock httpsCallableFromURL to return our mock function
jest.mock('@angular/fire/functions', () => ({
    Functions: jest.fn(),
    httpsCallableFromURL: jest.fn(() => mockListUsers)
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

    it('should call listUsers Cloud Function and return users', (done) => {
        const mockUsers = [
            { uid: '1', email: 'test@test.com', customClaims: { admin: true }, metadata: { lastSignInTime: 'now', creationTime: 'then' }, disabled: false }
        ];

        // Mock the return value of the cloud function call
        mockListUsers.mockReturnValue(Promise.resolve({ data: { users: mockUsers } }));

        service.getUsers().subscribe({
            next: (users) => {
                expect(httpsCallableFromURL).toHaveBeenCalledWith(functions, environment.functions.listUsers);
                expect(mockListUsers).toHaveBeenCalled();
                expect(users).toEqual(mockUsers);
                done();
            },
            error: (e) => done.fail(e)
        });
    });
});
