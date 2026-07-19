import { TestBed } from '@angular/core/testing';
import { AppPaymentService } from './app.payment.service';
import { Firestore } from 'app/firebase/firestore';
import { Auth } from 'app/firebase/auth';
import { Functions } from 'app/firebase/functions';
import { MatDialog } from '@angular/material/dialog';
import { FirebaseApp } from 'app/firebase/app';
import { AppWindowService } from './app.window.service';
import { AppFunctionsService } from './app.functions.service';
import { defer, firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
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
    mockSetDoc,
    mockGetDoc,
    mockGetDocsFromServer,
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
        mockSetDoc: vi.fn(),
        mockGetDoc: vi.fn(),
        mockGetDocsFromServer: vi.fn(),
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
        setDoc: mockSetDoc,
        getDoc: mockGetDoc,
        getDocsFromServer: mockGetDocsFromServer,
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
    let generatedCheckoutDocSequence = 0;

    beforeEach(() => {
        vi.clearAllMocks(); // Reset spies
        generatedCheckoutDocSequence = 0;

        mockAuth.currentUser = {
            uid: 'test_user_uid',
            getIdToken: vi.fn().mockResolvedValue('test-token')
        };
        mockFunctionsService.call.mockReset();
        mockFunctionsService.call.mockResolvedValue({ data: {} });

        // Configure mock implementations here where 'of' is available
        mockSetDoc.mockResolvedValue(undefined);
        mockDoc.mockImplementation((_parentOrFirestore: unknown, path?: string) => {
            if (typeof path === 'string') {
                return { id: path.split('/').pop(), path };
            }

            generatedCheckoutDocSequence += 1;
            return { id: `test_session_id_${generatedCheckoutDocSequence}` };
        });
        mockDocData.mockReturnValue(of({ url: 'http://stripe.com/checkout' }));
        mockCollectionData.mockReturnValue(of([]));
        mockGetDocsFromServer.mockResolvedValue({ docs: [] });
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

    it('should refresh auth and recover a permission-denied subscription listener', async () => {
        const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        let subscriptions = 0;
        mockCollectionData.mockReturnValue(defer(() => {
            subscriptions += 1;
            if (subscriptions <= 2) {
                return throwError(() => permissionDeniedError);
            }
            return of([{ id: 'sub_1', status: 'active', role: 'pro' }]);
        }));
        mockAuth.currentUser.getIdToken
            .mockRejectedValueOnce(Object.assign(new Error('Auth network unavailable'), {
                code: 'auth/network-request-failed'
            }))
            .mockResolvedValue('test-token');

        vi.useFakeTimers();
        try {
            const resultPromise = firstValueFrom(service.getUserSubscriptions());
            await vi.runAllTimersAsync();
            const result = await resultPromise;

            expect(result).toEqual([{ id: 'sub_1', status: 'active', role: 'pro' }]);
            expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledTimes(2);
            expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should bound subscription retries when each failed listener emits cached data first', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        let listenerSubscriptionCount = 0;
        mockCollectionData.mockReturnValue(new Observable((subscriber) => {
            listenerSubscriptionCount += 1;
            const version = listenerSubscriptionCount;
            subscriber.next([{ id: `sub_${version}`, status: 'active', role: 'pro' }]);

            const timeoutID = setTimeout(() => subscriber.error(unavailableError), 1);
            return () => clearTimeout(timeoutID);
        }));

        vi.useFakeTimers();
        try {
            const emittedIDs: string[] = [];
            let terminalError: unknown = null;
            const subscription = service.getUserSubscriptions().subscribe({
                next: (subscriptions) => {
                    if (subscriptions[0]?.id) {
                        emittedIDs.push(subscriptions[0].id);
                    }
                },
                error: (error) => {
                    terminalError = error;
                }
            });

            await vi.advanceTimersByTimeAsync(12000);

            expect(listenerSubscriptionCount).toBe(5);
            expect(emittedIDs).toEqual(['sub_1', 'sub_2', 'sub_3', 'sub_4', 'sub_5']);
            expect(terminalError).toBe(unavailableError);
            subscription.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should stop retrying a subscription listener when the authenticated user changes', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        const originalUser = mockAuth.currentUser;
        let listenerSubscriptionCount = 0;
        mockCollectionData.mockReturnValue(defer(() => {
            listenerSubscriptionCount += 1;
            mockAuth.currentUser = {
                uid: 'different_user_uid',
                getIdToken: vi.fn().mockResolvedValue('different-token')
            };
            return throwError(() => unavailableError);
        }));

        await expect(firstValueFrom(service.getUserSubscriptions())).rejects.toBe(unavailableError);

        expect(listenerSubscriptionCount).toBe(1);
        expect(originalUser.getIdToken).not.toHaveBeenCalled();
    });

    it('should stop a delayed subscription retry when the authenticated user changes during backoff', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        let listenerSubscriptionCount = 0;
        mockCollectionData.mockReturnValue(defer(() => {
            listenerSubscriptionCount += 1;
            return throwError(() => unavailableError);
        }));

        vi.useFakeTimers();
        try {
            const resultPromise = firstValueFrom(service.getUserSubscriptions());
            const resultExpectation = expect(resultPromise).rejects.toBe(unavailableError);
            await vi.advanceTimersByTimeAsync(0);
            mockAuth.currentUser = {
                uid: 'different_user_uid',
                getIdToken: vi.fn().mockResolvedValue('different-token')
            };

            await vi.advanceTimersByTimeAsync(750);
            await resultExpectation;

            expect(listenerSubscriptionCount).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    describe('appendCheckoutSession', () => {
        it('should add subscription checkout metadata and if_required payment collection when mode is subscription', async () => {
            const priceId = 'price_123';
            // Force mode to be subscription for this test by passing a price object with recurring type
            // or just rely on the string -> mode logic.
            // Service logic: const mode = typeof price === 'string' ? 'subscription' : ...

            // We pass a string, so mode defaults to 'subscription'
            await service.appendCheckoutSession(priceId);

            // Verify checkout document was written
            expect(mockSetDoc).toHaveBeenCalled();

            // Check arguments of the first call to setDoc
            // setDoc(ref, payload, options)
            const args = mockSetDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.mode).toBe('subscription');

            // CHECK 1: Top-level metadata
            expect(payload.metadata).toEqual({
                firebaseUID: 'test_user_uid'
            });

            // CHECK 2: Automatic Tax
            expect(payload.automatic_tax).toEqual({ enabled: true });
            expect(payload.payment_method_collection).toBe('if_required');
            expect(args[2]).toEqual({ merge: true });

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

            expect(mockSetDoc).toHaveBeenCalled();
            const args = mockSetDoc.mock.calls[0];
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

            expect(mockSetDoc).toHaveBeenCalled();
            const args = mockSetDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBe(14);
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
            expect(mockGetDocsFromServer).toHaveBeenCalledTimes(2);
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

            mockGetDocsFromServer.mockResolvedValueOnce({
                docs: [{ id: 'sub_existing' }]
            });

            await service.appendCheckoutSession(recurringPriceWithTrial);

            expect(mockSetDoc).toHaveBeenCalled();
            const args = mockSetDoc.mock.calls[0];
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

            mockGetDocsFromServer.mockRejectedValueOnce(new Error('Firestore unavailable'));

            await service.appendCheckoutSession(recurringPriceWithTrial);

            expect(mockSetDoc).toHaveBeenCalled();
            const args = mockSetDoc.mock.calls[0];
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

            expect(mockSetDoc).toHaveBeenCalled();
            const args = mockSetDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBeUndefined();
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
            expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1);
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

            expect(mockSetDoc).toHaveBeenCalled();
            const args = mockSetDoc.mock.calls[0];
            const payload = args[1];

            expect(payload.trial_period_days).toBeUndefined();
            expect(payload.promotion_code).toBeUndefined();
            expect(payload.allow_promotion_codes).toBe(true);
            expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1);
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
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('should not report a restored subscription after the authenticated account changes', async () => {
            let resolveLinkCheck: ((value: { data: { linked: boolean; role: string } }) => void) | undefined;
            mockFunctionsService.call.mockImplementationOnce(() => new Promise((resolve) => {
                resolveLinkCheck = resolve;
            }));

            const checkoutPromise = service.appendCheckoutSession('price_123');
            await vi.waitFor(() => expect(mockFunctionsService.call).toHaveBeenCalledWith('linkExistingStripeCustomer'));
            mockAuth.currentUser = {
                uid: 'different_user_uid',
                getIdToken: vi.fn().mockResolvedValue('different-token')
            };
            resolveLinkCheck?.({ data: { linked: true, role: 'pro' } });

            await expect(checkoutPromise).rejects.toThrow('Authenticated user changed while checkout was being prepared.');
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('should exit checkout when user cancels manage-subscription prompt', async () => {
            const dialog = TestBed.inject(MatDialog);
            vi.spyOn(dialog, 'open').mockReturnValue({
                afterClosed: () => of(false)
            } as any);
            mockGetDocsFromServer.mockResolvedValueOnce({
                docs: [{ id: 'sub_active', data: () => ({ status: 'active' }) }]
            });

            await service.appendCheckoutSession('price_123');

            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('should hand off to manageSubscriptions when user confirms existing-subscription prompt', async () => {
            const dialog = TestBed.inject(MatDialog);
            vi.spyOn(dialog, 'open').mockReturnValue({
                afterClosed: () => of(true)
            } as any);
            const manageSpy = vi.spyOn(service, 'manageSubscriptions').mockResolvedValue();
            mockGetDocsFromServer.mockResolvedValueOnce({
                docs: [{ id: 'sub_active', data: () => ({ status: 'active' }) }]
            });

            await service.appendCheckoutSession('price_123');

            expect(manageSpy).toHaveBeenCalledTimes(1);
            expect(manageSpy).toHaveBeenCalledWith('test_user_uid');
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('should not open a subscription portal if the account changes while the dialog is open', async () => {
            const dialog = TestBed.inject(MatDialog);
            const dialogClosed$ = new Subject<boolean>();
            const openSpy = vi.spyOn(dialog, 'open').mockReturnValue({
                afterClosed: () => dialogClosed$.asObservable()
            } as any);
            const manageSpy = vi.spyOn(service, 'manageSubscriptions').mockResolvedValue();
            mockGetDocsFromServer.mockResolvedValueOnce({
                docs: [{ id: 'sub_active', data: () => ({ status: 'active' }) }]
            });

            const checkoutPromise = service.appendCheckoutSession('price_123');
            await vi.waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
            mockAuth.currentUser = {
                uid: 'different_user_uid',
                getIdToken: vi.fn().mockResolvedValue('different-token')
            };
            dialogClosed$.next(true);

            await expect(checkoutPromise).rejects.toThrow('Authenticated user changed while checkout was being prepared.');
            expect(manageSpy).not.toHaveBeenCalled();
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('should fail closed when the active-subscription server check is unavailable', async () => {
            const readError = new Error('Firestore unavailable');
            mockGetDocsFromServer.mockRejectedValueOnce(readError);

            await expect(service.appendCheckoutSession('price_123')).rejects.toBe(readError);

            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('should not redirect to an old checkout session after the account changes', async () => {
            const checkoutSession$ = new Subject<{ url: string }>();
            mockDocData.mockReturnValueOnce(checkoutSession$.asObservable());

            const checkoutPromise = service.appendCheckoutSession('price_123');
            await vi.waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));
            mockAuth.currentUser = {
                uid: 'different_user_uid',
                getIdToken: vi.fn().mockResolvedValue('different-token')
            };
            checkoutSession$.next({ url: 'http://stripe.com/old-user-checkout' });

            await expect(checkoutPromise).rejects.toThrow('Authenticated user changed while checkout was being prepared.');
        });

        it('should not redirect to an old subscription portal after the account changes', async () => {
            let resolvePortalRequest: ((value: { data: { url: string } }) => void) | undefined;
            mockFunctionsService.call.mockImplementationOnce(() => new Promise((resolve) => {
                resolvePortalRequest = resolve;
            }));

            const portalPromise = service.manageSubscriptions();
            await vi.waitFor(() => expect(mockFunctionsService.call).toHaveBeenCalledWith(
                'createPortalLink',
                { returnUrl: 'http://localhost:4200/subscriptions' }
            ));
            mockAuth.currentUser = {
                uid: 'different_user_uid',
                getIdToken: vi.fn().mockResolvedValue('different-token')
            };
            resolvePortalRequest?.({ data: { url: 'http://stripe.com/old-user-portal' } });

            await expect(portalPromise).rejects.toThrow('Authenticated user changed while checkout was being prepared.');
        });

        it('should retry checkout once after stale customer error and then continue', async () => {
            mockDocData
                .mockReturnValueOnce(of({ error: { message: 'No such customer: cus_123' } }))
                .mockReturnValueOnce(of({ url: 'http://stripe.com/checkout' }));

            await service.appendCheckoutSession('price_123');

            expect(mockSetDoc).toHaveBeenCalledTimes(2);
            const cleanupCalls = mockFunctionsService.call.mock.calls.filter(call => call[0] === 'cleanupStripeCustomer');
            expect(cleanupCalls).toHaveLength(1);
        });

        it('should stop retrying after max retry attempts for stale customer errors', async () => {
            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
            mockDocData
                .mockReturnValueOnce(of({ error: { message: 'No such customer: cus_123' } }))
                .mockReturnValueOnce(of({ error: { message: 'No such customer: cus_456' } }));

            await service.appendCheckoutSession('price_123');

            expect(mockSetDoc).toHaveBeenCalledTimes(2);
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
            expect(mockGetDocsFromServer).not.toHaveBeenCalled();
        });

        it('should return true when at least one subscription document exists', async () => {
            mockGetDocsFromServer.mockResolvedValueOnce({
                docs: [{ id: 'sub_123' }]
            });

            const hasHistory = await service.hasPaidSubscriptionHistory();

            expect(hasHistory).toBe(true);
            expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1);
            expect(mockLimit).toHaveBeenCalledWith(1);
        });

        it('should return unknown when the history query fails so trial messaging stays hidden', async () => {
            mockGetDocsFromServer.mockRejectedValueOnce(new Error('Firestore unavailable'));

            const hasHistory = await service.hasPaidSubscriptionHistory();

            expect(hasHistory).toBeNull();
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
