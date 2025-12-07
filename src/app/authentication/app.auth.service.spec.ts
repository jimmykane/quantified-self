import { TestBed } from '@angular/core/testing';
import { AppAuthService } from './app.auth.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAnalytics } from '@angular/fire/compat/analytics';
import { AppUserService } from '../services/app.user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import { of, BehaviorSubject } from 'rxjs';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { Auth } from '@angular/fire/auth';

// Mock the modular authState function
const authState$ = new BehaviorSubject<any>(null);
jest.mock('@angular/fire/auth', () => {
    const originalModule = jest.requireActual('@angular/fire/auth');
    return {
        ...originalModule,
        authState: () => authState$.asObservable()
    };
});

describe('AppAuthService', () => {
    let service: AppAuthService;
    let authMock: any;
    let afsMock: any;
    let afaMock: any;
    let userServiceMock: any;
    let snackBarMock: any;
    let localStorageServiceMock: any;

    beforeEach(() => {
        authState$.next(null);
        authMock = {
            // The modular Auth object
        };

        afsMock = {
            firestore: {
                terminate: jasmine.createSpy('terminate').and.returnValue(Promise.resolve()),
                clearPersistence: jasmine.createSpy('clearPersistence').and.returnValue(Promise.resolve())
            }
        };

        afaMock = {};

        userServiceMock = {
            getUserByID: jasmine.createSpy('getUserByID').and.returnValue(of(new User('123', 'Test User', 'photo.jpg')))
        };

        snackBarMock = {
            open: jasmine.createSpy('open')
        };

        localStorageServiceMock = {
            clearAllStorage: jasmine.createSpy('clearAllStorage')
        };

        TestBed.configureTestingModule({
            providers: [
                AppAuthService,
                { provide: Auth, useValue: authMock },
                { provide: AngularFirestore, useValue: afsMock },
                { provide: AngularFireAnalytics, useValue: afaMock },
                { provide: AppUserService, useValue: userServiceMock },
                { provide: MatSnackBar, useValue: snackBarMock },
                { provide: LocalStorageService, useValue: localStorageServiceMock }
            ]
        });
        service = TestBed.inject(AppAuthService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should emit user when authenticated', (done) => {
        const mockUser = { uid: '123', isAnonymous: false, metadata: { creationTime: 'now', lastSignInTime: 'now' } };
        authState$.next(mockUser);

        service.user$.subscribe(user => {
            expect(user).toBeTruthy();
            expect(user.uid).toBe('123');
            expect(userServiceMock.getUserByID).toHaveBeenCalledWith('123');
            done();
        });
    });

    it('should emit null when not authenticated', (done) => {
        authState$.next(null);

        service.user$.subscribe(user => {
            expect(user).toBeNull();
            done();
        });
    });
});
