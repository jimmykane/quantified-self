import { TestBed } from '@angular/core/testing';
import { AppPaymentService } from './app.payment.service';
import { Firestore } from 'app/firebase/firestore';
import { Auth } from 'app/firebase/auth';
import { Functions } from 'app/firebase/functions';
import { MatDialog } from '@angular/material/dialog';
import { FirebaseApp } from 'app/firebase/app';
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
vi.mock('app/firebase/functions', async () => {
    const actual = await vi.importActual('app/firebase/functions');
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
vi.mock('app/firebase/firestore', async () => {
    const actual = await vi.importActual('app/firebase/firestore');
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
        it('should add subscription checkout metadata and if_required payment collection when mode is subscription', async () => {
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
            expect(payload.payment_method_collection).toBe('if_required');

            // CHECK 3: Extension-compatible trial field remains top-level
            expect(payload.subscription_data).toBeUndefined();
            expect(payload.trial_period_days).toBeUndefined();
            expect(payload).not.toHaveProperty('payment_method_types');
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
            expect(payload.payment_method_collection).toBeUndefined();
            expect(payload).not.toHaveProperty('payment_method_types');
        });

        it('should set trial_period_days for eligible first-time recurring checkout', async () => {
            const recurringPriceWithTrial = {
                id: 'price_recurring_trial',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with trial',
                trial_period_days: null,
                metadata: {
                    trial_days: '14'
                }
            } as any;

            await service.appendCheckoutSession(recurringPriceWithTrial);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBe(14);
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
            expect(mockGetDocs).toHaveBeenCalledTimes(1);
        });

        it('should not set trial_period_days when user has paid subscription history', async () => {
            const recurringPriceWithTrial = {
                id: 'price_recurring_trial_history',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with trial for returning customer',
                trial_period_days: null,
                metadata: {
                    trial_days: '14'
                }
            } as any;

            mockGetDocs.mockResolvedValueOnce({
                docs: [{ id: 'sub_existing' }]
            });

            await service.appendCheckoutSession(recurringPriceWithTrial);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBeUndefined();
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
        });

        it('should not set trial_period_days when history lookup fails during checkout gating (fail-closed)', async () => {
            const recurringPriceWithTrial = {
                id: 'price_recurring_trial_history_error',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with trial when history lookup fails',
                trial_period_days: null,
                metadata: {
                    trial_days: '14'
                }
            } as any;

            mockGetDocs.mockRejectedValueOnce(new Error('Firestore unavailable'));

            await service.appendCheckoutSession(recurringPriceWithTrial);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBeUndefined();
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
        });

        it('should not set trial_period_days when recurring price has no valid trial days', async () => {
            const recurringPriceWithoutTrial = {
                id: 'price_recurring_no_trial',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly without trial',
                trial_period_days: null,
                metadata: {}
            } as any;

            await service.appendCheckoutSession(recurringPriceWithoutTrial);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBeUndefined();
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
            expect(mockGetDocs).not.toHaveBeenCalled();
        });

        it('should not set trial_period_days when metadata.trial_days is invalid', async () => {
            const recurringPriceWithInvalidTrialMetadata = {
                id: 'price_recurring_invalid_trial_metadata',
                type: 'recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly with invalid metadata trial value',
                trial_period_days: null,
                metadata: {
                    trial_days: '30days'
                }
            } as any;

            await service.appendCheckoutSession(recurringPriceWithInvalidTrialMetadata);

            expect(mockAddDoc).toHaveBeenCalled();
            const args = mockAddDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBeUndefined();
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
            expect(mockGetDocs).not.toHaveBeenCalled();
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

    });

    describe('getUpcomingRenewalAmount', () => {
        it('should call getUpcomingRenewalAmount callable and return ready state', async () => {
            mockFunctionsService.call.mockResolvedValueOnce({
                data: {
                    status: 'ready',
                    amountMinor: 2499,
                    currency: 'eur'
                }
            });

            const result = await service.getUpcomingRenewalAmount();

            expect(mockFunctionsService.call).toHaveBeenCalledWith('getUpcomingRenewalAmount');
            expect(result).toEqual({
                status: 'ready',
                amountMinor: 2499,
                currency: 'EUR'
            });
        });

        it('should return no_upcoming_charge state from callable result', async () => {
            mockFunctionsService.call.mockResolvedValueOnce({
                data: {
                    status: 'no_upcoming_charge'
                }
            });

            const result = await service.getUpcomingRenewalAmount();

            expect(result).toEqual({ status: 'no_upcoming_charge' });
        });

        it('should return unavailable for malformed callable result', async () => {
            mockFunctionsService.call.mockResolvedValueOnce({
                data: {
                    status: 'ready',
                    amountMinor: 'invalid',
                    currency: 123
                }
            });

            const result = await service.getUpcomingRenewalAmount();

            expect(result).toEqual({ status: 'unavailable' });
        });

        it('should return unavailable when callable fails', async () => {
            mockFunctionsService.call.mockRejectedValueOnce(new Error('network failed'));

            const result = await service.getUpcomingRenewalAmount();

            expect(result).toEqual({ status: 'unavailable' });
        });

        it('should return unavailable and skip callable when user is not authenticated', async () => {
            mockAuth.currentUser = null;

            const result = await service.getUpcomingRenewalAmount();

            expect(result).toEqual({ status: 'unavailable' });
            expect(mockFunctionsService.call).not.toHaveBeenCalled();
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

        it('should return false when the history query fails (fail-open for trial messaging)', async () => {
            mockGetDocs.mockRejectedValueOnce(new Error('Firestore unavailable'));

            const hasHistory = await service.hasPaidSubscriptionHistory();

            expect(hasHistory).toBe(false);
        });
    });

    describe('transformProductsForPricing', () => {
        it('should keep monthly and yearly recurring prices for role-split products', () => {
            const result = (service as any).transformProductsForPricing([
                {
                    id: 'prod_role_split',
                    metadata: {},
                    prices: [
                        {
                            id: 'price_basic_monthly',
                            type: 'recurring',
                            interval: 'month',
                            metadata: { firebaseRole: 'basic' }
                        },
                        {
                            id: 'price_basic_yearly',
                            type: 'recurring',
                            interval: 'year',
                            metadata: { firebaseRole: 'basic' }
                        },
                        {
                            id: 'price_pro_monthly',
                            type: 'recurring',
                            interval: 'month',
                            metadata: { firebaseRole: 'pro' }
                        },
                        {
                            id: 'price_pro_yearly',
                            type: 'recurring',
                            interval: 'year',
                            metadata: { firebaseRole: 'pro' }
                        }
                    ]
                }
            ]);

            expect(result).toHaveLength(2);
            expect(result[0].role).toBe('basic');
            expect(result[0].prices).toEqual([
                expect.objectContaining({ id: 'price_basic_monthly' }),
                expect.objectContaining({ id: 'price_basic_yearly' })
            ]);
            expect(result[1].role).toBe('pro');
            expect(result[1].prices).toEqual([
                expect.objectContaining({ id: 'price_pro_monthly' }),
                expect.objectContaining({ id: 'price_pro_yearly' })
            ]);
        });

        it('should keep fallback products when they only have yearly prices', () => {
            const result = (service as any).transformProductsForPricing([
                {
                    id: 'prod_legacy_yearly_only',
                    metadata: { role: 'basic' },
                    prices: [
                        {
                            id: 'price_yearly_only',
                            type: 'recurring',
                            interval: 'year',
                            metadata: {}
                        }
                    ]
                },
                {
                    id: 'prod_legacy_monthly',
                    metadata: { role: 'pro' },
                    prices: [
                        {
                            id: 'price_monthly_only',
                            type: 'recurring',
                            interval: 'month',
                            metadata: {}
                        }
                    ]
                }
            ]);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('prod_legacy_yearly_only');
            expect(result[0].prices).toEqual([
                expect.objectContaining({ id: 'price_yearly_only' })
            ]);
            expect(result[1].id).toBe('prod_legacy_monthly');
            expect(result[1].prices).toEqual([
                expect.objectContaining({ id: 'price_monthly_only' })
            ]);
        });

        it('should merge same-role recurring prices across separate Stripe products into one pricing card', () => {
            const result = (service as any).transformProductsForPricing([
                {
                    id: 'prod_basic_monthly',
                    metadata: { role: 'basic' },
                    prices: [
                        {
                            id: 'price_basic_monthly',
                            type: 'recurring',
                            interval: 'month',
                            interval_count: 1,
                            unit_amount: 99,
                            metadata: {}
                        }
                    ]
                },
                {
                    id: 'prod_basic_yearly',
                    metadata: { role: 'basic' },
                    prices: [
                        {
                            id: 'price_basic_yearly',
                            type: 'recurring',
                            interval: 'year',
                            interval_count: 1,
                            unit_amount: 1999,
                            metadata: {}
                        }
                    ]
                },
                {
                    id: 'prod_pro_monthly',
                    metadata: { role: 'pro' },
                    prices: [
                        {
                            id: 'price_pro_monthly',
                            type: 'recurring',
                            interval: 'month',
                            interval_count: 1,
                            unit_amount: 399,
                            metadata: {}
                        }
                    ]
                }
            ]);

            expect(result).toHaveLength(2);
            expect(result[0].role).toBe('basic');
            expect(result[0].prices).toEqual([
                expect.objectContaining({ id: 'price_basic_monthly' }),
                expect.objectContaining({ id: 'price_basic_yearly' })
            ]);
            expect(result[1].role).toBe('pro');
            expect(result[1].prices).toEqual([
                expect.objectContaining({ id: 'price_pro_monthly' })
            ]);
        });
    });
});
