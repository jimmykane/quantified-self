import { TestBed } from '@angular/core/testing';
import { AppPaymentService } from './app.payment.service';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import { FirebaseApp } from '@angular/fire/app';
import { AppWindowService } from './app.window.service';
import { AppFunctionsService } from './app.functions.service';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockHttpsCallableFromURL } = vi.hoisted(() => {
    return {
        mockHttpsCallableFromURL: vi.fn().mockReturnValue(() => Promise.resolve({ data: {} }))
    };
});

// Mock functions module
vi.mock('@angular/fire/functions', async () => {
    const actual = await vi.importActual('@angular/fire/functions');
    return {
        ...actual,
        httpsCallableFromURL: mockHttpsCallableFromURL
    };
});


const {
    mockAddDoc,
    mockDocData,
    mockCollection,
    mockDoc,
    mockCollectionData,
    mockQuery,
    mockWhere,
    mockRunInInjectionContext
} = vi.hoisted(() => {
    return {
        mockAddDoc: vi.fn(),
        mockDocData: vi.fn(),
        mockCollection: vi.fn(),
        mockDoc: vi.fn(),
        mockCollectionData: vi.fn(),
        mockQuery: vi.fn(),
        mockWhere: vi.fn(),
        mockRunInInjectionContext: vi.fn()
    };
});

// Mock the module
vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        addDoc: mockAddDoc,
        collection: mockCollection,
        doc: mockDoc,
        docData: mockDocData,
        collectionData: mockCollectionData,
        query: mockQuery,
        where: mockWhere,
        runInInjectionContext: mockRunInInjectionContext
    };
});

// Mock values
const mockFirebaseApp = {};
const mockWindowService = {
    currentDomain: 'http://localhost:4200'
};
const mockFirestore = {}; // The service injects the class token
const mockAuth = {
    currentUser: {
        uid: 'test_user_uid',
        getIdToken: vi.fn()
    }
};
const mockFunctions = {};
const mockDialog = { open: () => ({ afterClosed: () => of(true) }) };
const mockFunctionsService = {
    call: vi.fn().mockResolvedValue({ data: {} })
};

describe('AppPaymentService', () => {
    let service: AppPaymentService;

    beforeEach(() => {
        vi.clearAllMocks(); // Reset spies

        // Configure mock implementations here where 'of' is available
        mockAddDoc.mockResolvedValue({ id: 'test_session_id' });
        mockDocData.mockReturnValue(of({ url: 'http://stripe.com/checkout' }));
        mockCollectionData.mockReturnValue(of([]));
        mockRunInInjectionContext.mockImplementation((injector: any, fn: any) => fn());

        TestBed.configureTestingModule({
            providers: [
                AppPaymentService,
                { provide: FirebaseApp, useValue: mockFirebaseApp },
                { provide: AppWindowService, useValue: mockWindowService },
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
                { provide: Functions, useValue: mockFunctions },
                { provide: MatDialog, useValue: mockDialog },
                { provide: AppFunctionsService, useValue: mockFunctionsService }
            ]
        });
        service = TestBed.inject(AppPaymentService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('appendCheckoutSession', () => {
        it('should add metadata.firebaseUID to the session payload and subscription_data when mode is subscription', async () => {
            const priceId = 'price_123';
            // Force mode to be subscription for this test by passing a price object with recurring type
            // or just rely on the string -> mode logic.
            // Service logic: const mode = typeof price === 'string' ? 'subscription' : ...

            // We pass a string, so mode defaults to 'subscription'
            await service.appendCheckoutSession(priceId);

            // Verify addDoc was called
            expect(mockAddDoc).toHaveBeenCalled();

            // Check arguments of the first call to addDoc
            // addDoc(ref, payload)
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.mode).toBe('subscription');

            // CHECK 1: Top-level metadata
            expect(payload.metadata).toEqual({
                firebaseUID: 'test_user_uid'
            });

            // CHECK 2: Subscription data metadata
            expect(payload.subscription_data).toBeDefined();
            expect(payload.subscription_data.metadata).toEqual({
                firebaseUID: 'test_user_uid'
            });
        });

        it('should add metadata.firebaseUID to the session payload but NOT subscription_data when mode is payment', async () => {
            // Service logic: mode is 'payment' if price object has type != recurring
            const oneTimePrice = {
                id: 'price_onetime',
                type: 'one_time',
                active: true,
                currency: 'eur',
                unit_amount: 1000,
                description: 'Lifetime'
            } as any;

            await service.appendCheckoutSession(oneTimePrice);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.mode).toBe('payment');

            // CHECK 1: Top-level metadata MUST be present
            expect(payload.metadata).toEqual({
                firebaseUID: 'test_user_uid'
            });

            // CHECK 2: Subscription data must NOT be present
            expect(payload.subscription_data).toBeUndefined();
        });
    });
    describe('restorePurchases', () => {
        it('should return the role from the cloud function response', async () => {
            // Mock the callable function to return specific data
            mockFunctionsService.call.mockResolvedValue({ data: { success: true, role: 'pro' } });

            const role = await service.restorePurchases();

            expect(role).toBe('pro');
            expect(mockFunctionsService.call).toHaveBeenCalledWith('restoreUserClaims');
        });
    });
});
