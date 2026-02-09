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
    mockGetDoc,
    mockGetDocs,
    mockLimit,
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
        mockGetDoc: vi.fn(),
        mockGetDocs: vi.fn(),
        mockLimit: vi.fn(),
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
        getDoc: mockGetDoc,
        getDocs: mockGetDocs,
        limit: mockLimit,
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

        mockAuth.currentUser = {
            uid: 'test_user_uid',
            getIdToken: vi.fn()
        };
        mockFunctionsService.call.mockReset();
        mockFunctionsService.call.mockResolvedValue({ data: {} });

        // Configure mock implementations here where 'of' is available
        mockAddDoc.mockResolvedValue({ id: 'test_session_id' });
        mockDocData.mockReturnValue(of({ url: 'http://stripe.com/checkout' }));
        mockCollectionData.mockReturnValue(of([]));
        mockGetDocs.mockResolvedValue({ docs: [] });
        mockGetDoc.mockResolvedValue({
            exists: () => false,
            data: () => undefined
        });
        mockLimit.mockImplementation((value: number) => value);
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

            // CHECK 2: Automatic Tax
            expect(payload.automatic_tax).toEqual({ enabled: true });

            // CHECK 3: Subscription data metadata
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

            // CHECK 2: Automatic Tax
            expect(payload.automatic_tax).toEqual({ enabled: true });

            // CHECK 3: Subscription data must NOT be present
            expect(payload.subscription_data).toBeUndefined();
        });

        it('should set promotion_code and disable manual promotion codes when price metadata contains a valid promotion code ID', async () => {
            const recurringPriceWithPromo = {
                id: 'price_recurring_promo',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with promo',
                metadata: {
                    promotion_code_id: 'promo_123456789'
                }
            } as any;

            await service.appendCheckoutSession(recurringPriceWithPromo);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.promotion_code).toBe('promo_123456789');
            expect(payload.allow_promotion_codes).toBe(false);
        });

        it('should ignore non-ID promotion code metadata and keep manual promotion codes enabled', async () => {
            const recurringPriceWithInvalidPromo = {
                id: 'price_recurring_invalid_promo',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with invalid promo',
                metadata: {
                    promotion_code_id: 'SAVE10'
                }
            } as any;

            await service.appendCheckoutSession(recurringPriceWithInvalidPromo);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
        });

        it('should ignore legacy promotion code metadata keys and keep manual promotion codes enabled', async () => {
            const recurringPriceWithLegacyPromoKey = {
                id: 'price_recurring_legacy_promo',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with legacy promo key',
                metadata: {
                    promotionCodeId: 'promo_111111111'
                }
            } as any;

            await service.appendCheckoutSession(recurringPriceWithLegacyPromoKey);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
        });

        it('should apply promotion code from stripe_metadata_promotion_code_id fallback field', async () => {
            const recurringPriceWithPrefixedPromo = {
                id: 'price_recurring_prefixed_promo',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with prefixed promo metadata',
                stripe_metadata_promotion_code_id: 'promo_987654321'
            } as any;

            await service.appendCheckoutSession(recurringPriceWithPrefixedPromo);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.promotion_code).toBe('promo_987654321');
            expect(payload.allow_promotion_codes).toBe(false);
        });

        it('should restore and short-circuit checkout when an existing subscription is linked', async () => {
            mockFunctionsService.call.mockImplementation(async (functionName: string) => {
                if (functionName === 'linkExistingStripeCustomer') {
                    return { data: { linked: true, role: 'pro' } };
                }
                return { data: {} };
            });

            await expect(service.appendCheckoutSession('price_123')).rejects.toThrow('SUBSCRIPTION_RESTORED:pro');
            expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith(true);
            expect(mockAddDoc).not.toHaveBeenCalled();
        });

        it('should exit checkout when user cancels manage-subscription prompt', async () => {
            const dialog = TestBed.inject(MatDialog);
            vi.spyOn(dialog, 'open').mockReturnValue({
                afterClosed: () => of(false)
            } as any);
            mockCollectionData.mockReturnValueOnce(of([{ status: 'active' }]));

            await service.appendCheckoutSession('price_123');

            expect(mockAddDoc).not.toHaveBeenCalled();
        });

        it('should hand off to manageSubscriptions when user confirms existing-subscription prompt', async () => {
            const dialog = TestBed.inject(MatDialog);
            vi.spyOn(dialog, 'open').mockReturnValue({
                afterClosed: () => of(true)
            } as any);
            const manageSpy = vi.spyOn(service, 'manageSubscriptions').mockResolvedValue();
            mockCollectionData.mockReturnValueOnce(of([{ status: 'active' }]));

            await service.appendCheckoutSession('price_123');

            expect(manageSpy).toHaveBeenCalledTimes(1);
            expect(mockAddDoc).not.toHaveBeenCalled();
        });

        it('should retry checkout once after stale customer error and then continue', async () => {
            mockDocData
                .mockReturnValueOnce(of({ error: { message: 'No such customer: cus_123' } }))
                .mockReturnValueOnce(of({ url: 'http://stripe.com/checkout' }));

            await service.appendCheckoutSession('price_123');

            expect(mockAddDoc).toHaveBeenCalledTimes(2);
            const cleanupCalls = mockFunctionsService.call.mock.calls.filter(call => call[0] === 'cleanupStripeCustomer');
            expect(cleanupCalls).toHaveLength(1);
        });

        it('should stop retrying after max retry attempts for stale customer errors', async () => {
            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
            mockDocData
                .mockReturnValueOnce(of({ error: { message: 'No such customer: cus_123' } }))
                .mockReturnValueOnce(of({ error: { message: 'No such customer: cus_456' } }));

            await service.appendCheckoutSession('price_123');

            expect(mockAddDoc).toHaveBeenCalledTimes(2);
            const cleanupCalls = mockFunctionsService.call.mock.calls.filter(call => call[0] === 'cleanupStripeCustomer');
            expect(cleanupCalls).toHaveLength(1);
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('No such customer'));
            alertSpy.mockRestore();
        });

        it('should apply promotion code from Firestore price document metadata fallback', async () => {
            const recurringPriceWithoutPromoMetadata = {
                id: 'price_firestore_fallback',
                product: 'prod_123',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly without inline promo metadata',
                metadata: {}
            } as any;

            mockGetDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => ({
                    metadata: {
                        promotion_code_id: 'promo_firestore_123'
                    }
                })
            });

            await service.appendCheckoutSession(recurringPriceWithoutPromoMetadata);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];
            expect(payload.promotion_code).toBe('promo_firestore_123');
            expect(payload.allow_promotion_codes).toBe(false);
            expect(mockGetDocs).not.toHaveBeenCalled();
        });

        it('should apply promotion code from active-product scan when product ID is not present on price object', async () => {
            const recurringPriceWithoutProduct = {
                id: 'price_firestore_scan_fallback',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly without product',
                metadata: {}
            } as any;

            mockGetDocs.mockResolvedValueOnce({
                docs: [{ id: 'prod_from_scan' }]
            });
            mockGetDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => ({
                    stripe_metadata_promotion_code_id: 'promo_firestore_scan'
                })
            });

            await service.appendCheckoutSession(recurringPriceWithoutProduct);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];
            expect(payload.promotion_code).toBe('promo_firestore_scan');
            expect(payload.allow_promotion_codes).toBe(false);
            expect(mockGetDocs).toHaveBeenCalledTimes(1);
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

    describe('hasPaidSubscriptionHistory', () => {
        it('should return false when there is no authenticated user', async () => {
            mockAuth.currentUser = null;

            const hasHistory = await service.hasPaidSubscriptionHistory();

            expect(hasHistory).toBe(false);
            expect(mockGetDocs).not.toHaveBeenCalled();
        });

        it('should return true when at least one subscription document exists', async () => {
            mockGetDocs.mockResolvedValueOnce({
                docs: [{ id: 'sub_123' }]
            });

            const hasHistory = await service.hasPaidSubscriptionHistory();

            expect(hasHistory).toBe(true);
            expect(mockGetDocs).toHaveBeenCalledTimes(1);
            expect(mockLimit).toHaveBeenCalledWith(1);
        });

        it('should return true when the history query fails (fail-closed for trial messaging)', async () => {
            mockGetDocs.mockRejectedValueOnce(new Error('Firestore unavailable'));

            const hasHistory = await service.hasPaidSubscriptionHistory();

            expect(hasHistory).toBe(true);
        });
    });
});
