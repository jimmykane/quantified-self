import type Stripe from 'stripe';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    GrantAdminSubscriptionGiftRequest,
    GrantAdminSubscriptionGiftResponse,
    PreviewAdminSubscriptionGiftRequest,
    PreviewAdminSubscriptionGiftResponse,
} from '../../../shared/admin-subscription-gifts';

const {
    mockAuthGetUser,
    mockFirestore,
    mockGetAdminBillingStripe,
    mockDeletionGuard,
    mockTransactionDeletionGuard,
    mockStripeRetrieve,
    mockStripeUpdate,
} = vi.hoisted(() => ({
    mockAuthGetUser: vi.fn(),
    mockFirestore: vi.fn(),
    mockGetAdminBillingStripe: vi.fn(),
    mockDeletionGuard: vi.fn(),
    mockTransactionDeletionGuard: vi.fn(),
    mockStripeRetrieve: vi.fn(),
    mockStripeUpdate: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    auth: () => ({ getUser: mockAuthGetUser }),
    firestore: mockFirestore,
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('./shared/auth', () => ({}));

vi.mock('../shared/auth', () => ({
    onAdminCall: (_options: unknown, handler: unknown) => handler,
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: mockDeletionGuard,
    getUserDeletionGuardStateInTransaction: mockTransactionDeletionGuard,
}));

vi.mock('../stripe/client', () => ({
    getAdminBillingStripe: mockGetAdminBillingStripe,
}));

class FakeDocumentSnapshot {
    constructor(
        readonly id: string,
        private readonly value: Record<string, unknown> | undefined,
    ) {}

    get exists(): boolean {
        return this.value !== undefined;
    }

    data(): Record<string, unknown> | undefined {
        return this.value;
    }
}

class FakeDocumentReference {
    readonly id: string;

    constructor(
        readonly path: string,
        private readonly store: Map<string, Record<string, unknown>>,
    ) {
        this.id = path.split('/').at(-1) || '';
    }

    async get(): Promise<FakeDocumentSnapshot> {
        return new FakeDocumentSnapshot(this.id, this.store.get(this.path));
    }

    async set(value: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
        const current = options?.merge ? this.store.get(this.path) || {} : {};
        this.store.set(this.path, { ...current, ...value });
    }
}

class FakeCollectionReference {
    private filters: Array<{ field: string; operator: string; value: unknown }> = [];
    private limitCount: number | null = null;

    constructor(
        readonly path: string,
        private readonly store: Map<string, Record<string, unknown>>,
    ) {}

    doc(id: string): FakeDocumentReference {
        return new FakeDocumentReference(`${this.path}/${id}`, this.store);
    }

    where(field: string, operator: string, value: unknown): this {
        this.filters.push({ field, operator, value });
        return this;
    }

    orderBy(): this {
        return this;
    }

    limit(value: number): this {
        this.limitCount = value;
        return this;
    }

    async get(): Promise<{ docs: FakeDocumentSnapshot[]; empty: boolean; size: number }> {
        const prefix = `${this.path}/`;
        let docs = [...this.store.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .map(([path, value]) => new FakeDocumentSnapshot(path.slice(prefix.length), value));
        for (const filter of this.filters) {
            docs = docs.filter(document => {
                const fieldValue = document.data()?.[filter.field];
                if (filter.operator === 'in' && Array.isArray(filter.value)) {
                    return filter.value.includes(fieldValue);
                }
                return true;
            });
        }
        if (this.limitCount !== null) {
            docs = docs.slice(0, this.limitCount);
        }
        return { docs, empty: docs.length === 0, size: docs.length };
    }
}

class FakeFirestore {
    readonly store = new Map<string, Record<string, unknown>>();

    doc(path: string): FakeDocumentReference {
        return new FakeDocumentReference(path, this.store);
    }

    collection(path: string): FakeCollectionReference {
        return new FakeCollectionReference(path, this.store);
    }

    async runTransaction<T>(callback: (transaction: {
        get: (reference: FakeDocumentReference) => Promise<FakeDocumentSnapshot>;
        set: (reference: FakeDocumentReference, value: Record<string, unknown>, options?: { merge?: boolean }) => void;
        create: (reference: FakeDocumentReference, value: Record<string, unknown>) => void;
    }) => Promise<T>): Promise<T> {
        return callback({
            get: reference => reference.get(),
            set: (reference, value, options) => {
                const current = options?.merge ? this.store.get(reference.path) || {} : {};
                this.store.set(reference.path, { ...current, ...value });
            },
            create: (reference, value) => {
                if (this.store.has(reference.path)) {
                    throw new Error(`Document already exists: ${reference.path}`);
                }
                this.store.set(reference.path, { ...value });
            },
        });
    }
}

function unixSeconds(value: string): number {
    return Math.floor(Date.parse(value) / 1000);
}

function buildSubscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
    return {
        id: 'sub_basic',
        object: 'subscription',
        status: 'active',
        trial_end: null,
        cancel_at_period_end: false,
        schedule: null,
        billing_mode: { type: 'classic', flexible: null },
        billing_schedules: [],
        pause_collection: null,
        automatic_tax: { enabled: true, disabled_reason: null, liability: null },
        default_tax_rates: [],
        metadata: { firebaseUID: 'target-user', retained: 'yes' },
        items: {
            object: 'list',
            data: [{
                id: 'si_basic',
                object: 'subscription_item',
                current_period_start: unixSeconds('2026-08-31T12:00:00Z'),
                current_period_end: unixSeconds('2026-09-30T12:00:00Z'),
                price: {
                    id: 'price_basic_monthly',
                    recurring: { interval: 'month', interval_count: 1 },
                },
                quantity: 1,
                tax_rates: [],
            }],
            has_more: false,
            url: '/v1/subscription_items',
        },
        ...overrides,
    } as unknown as Stripe.Subscription;
}

function callableRequest<T>(data: T, actorUid = 'admin-user'): CallableRequest<T> {
    return {
        data,
        auth: { uid: actorUid, token: { admin: true } },
        app: { appId: 'test-app' },
    } as unknown as CallableRequest<T>;
}

const operationId = '00000000-0000-4000-8000-000000000001';
const secondOperationId = '00000000-0000-4000-8000-000000000002';

const handlers = await import('./handlers/subscription-gifts.handlers');
const previewGift = handlers.previewAdminSubscriptionGift as unknown as (
    request: CallableRequest<PreviewAdminSubscriptionGiftRequest>,
) => Promise<PreviewAdminSubscriptionGiftResponse>;
const grantGift = handlers.grantAdminSubscriptionGift as unknown as (
    request: CallableRequest<GrantAdminSubscriptionGiftRequest>,
) => Promise<GrantAdminSubscriptionGiftResponse>;

describe('admin subscription gift callables', () => {
    let db: FakeFirestore;
    let currentSubscription: Stripe.Subscription;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
        vi.clearAllMocks();
        db = new FakeFirestore();
        currentSubscription = buildSubscription();
        db.store.set('customers/target-user/subscriptions/sub_basic', {
            status: 'active',
            role: 'basic',
            created: unixSeconds('2026-08-01T00:00:00Z'),
        });
        mockFirestore.mockReturnValue(db);
        mockAuthGetUser.mockImplementation(async (uid: string) => ({
            uid,
            email: `${uid}@example.com`,
            customClaims: uid === 'admin-target' ? { admin: true, stripeRole: 'pro' } : { stripeRole: 'basic' },
        }));
        mockDeletionGuard.mockResolvedValue({ userExists: true, deletionInProgress: false, shouldSkip: false });
        mockTransactionDeletionGuard.mockResolvedValue({ userExists: true, deletionInProgress: false, shouldSkip: false });
        mockStripeRetrieve.mockImplementation(async () => currentSubscription);
        mockStripeUpdate.mockImplementation(async (_id: string, params: Stripe.SubscriptionUpdateParams) => {
            const target = params.trial_end as number;
            currentSubscription = buildSubscription({
                status: 'trialing',
                trial_end: target,
                cancel_at_period_end: currentSubscription.cancel_at_period_end,
                metadata: {
                    ...currentSubscription.metadata,
                    ...(params.metadata as Record<string, string>),
                },
                items: {
                    ...currentSubscription.items,
                    data: currentSubscription.items.data.map(item => ({
                        ...item,
                        current_period_end: target,
                    })),
                },
            });
            return currentSubscription;
        });
        mockGetAdminBillingStripe.mockResolvedValue({
            subscriptions: {
                retrieve: mockStripeRetrieve,
                update: mockStripeUpdate,
            },
        });
    });

    it('previews exact dates, plan details, cancellation, and recent history', async () => {
        currentSubscription = buildSubscription({ cancel_at_period_end: true });
        const response = await previewGift(callableRequest({ uid: 'target-user', months: 2 }));

        expect(response).toEqual(expect.objectContaining({
            uid: 'target-user',
            subscriptionId: 'sub_basic',
            role: 'basic',
            cadence: 'monthly',
            status: 'active',
            currentAccessEnd: '2026-09-30T12:00:00.000Z',
            proposedGiftedEnd: '2026-11-30T12:00:00.000Z',
            cancelAtPeriodEnd: true,
            recentHistory: [],
        }));
        expect(response.previewVersion).toMatch(/^pv1_/);
    });

    it('rejects malformed requests before reading Stripe', async () => {
        await expect(previewGift(callableRequest({ uid: 'target-user', months: 0 })))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(previewGift(callableRequest({ uid: 'target-user', months: 1, unexpected: true } as never)))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockStripeRetrieve).not.toHaveBeenCalled();
    });

    it('rejects self-targeting, admin targets, and deletion-pending accounts', async () => {
        await expect(previewGift(callableRequest({ uid: 'admin-user', months: 1 })))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        db.store.set('customers/admin-target/subscriptions/sub_admin', {
            status: 'active', role: 'pro', created: 1,
        });
        await expect(previewGift(callableRequest({ uid: 'admin-target', months: 1 })))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        mockDeletionGuard.mockResolvedValueOnce({ userExists: true, deletionInProgress: true, shouldSkip: true });
        await expect(previewGift(callableRequest({ uid: 'target-user', months: 1 })))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('rejects multiple paid subscriptions', async () => {
        db.store.set('customers/target-user/subscriptions/sub_second', {
            status: 'trialing', role: 'pro', created: 2,
        });
        mockStripeRetrieve.mockImplementation(async (id: string) => buildSubscription({ id }));

        await expect(previewGift(callableRequest({ uid: 'target-user', months: 1 })))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('rejects multiple current subscription records even when only one resolves to a paid role', async () => {
        db.store.set('customers/target-user/subscriptions/sub_second', {
            status: 'trialing', created: 2,
        });
        mockAuthGetUser.mockImplementation(async (uid: string) => ({
            uid,
            email: `${uid}@example.com`,
            customClaims: {},
        }));
        mockStripeRetrieve.mockImplementation(async (id: string) => buildSubscription({ id }));

        await expect(previewGift(callableRequest({ uid: 'target-user', months: 1 })))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('rejects an explicitly Free subscription even when the Auth claim is stale and paid', async () => {
        db.store.set('customers/target-user/subscriptions/sub_basic', {
            status: 'active',
            role: 'free',
            created: unixSeconds('2026-08-01T00:00:00Z'),
        });

        await expect(previewGift(callableRequest({ uid: 'target-user', months: 1 })))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('requires a fresh matching preview', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));

        await expect(grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: true,
            operationId,
            previewVersion: `${preview.previewVersion}stale`,
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockStripeUpdate).not.toHaveBeenCalled();
    });

    it('applies an absolute trial end without proration or plan, tax, and cancellation parameters', async () => {
        currentSubscription = buildSubscription({ cancel_at_period_end: true });
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        const response = await grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: true,
            operationId,
            previewVersion: preview.previewVersion,
        }));

        expect(response).toEqual(expect.objectContaining({
            operationId,
            status: 'succeeded',
            previousAccessEnd: '2026-09-30T12:00:00.000Z',
            newAccessEnd: '2026-10-30T12:00:00.000Z',
            cancelAtPeriodEnd: true,
            notificationStatus: 'queued',
        }));
        expect(mockStripeUpdate).toHaveBeenCalledWith(
            'sub_basic',
            {
                trial_end: unixSeconds('2026-10-30T12:00:00Z'),
                proration_behavior: 'none',
                metadata: {
                    qs_gift_type: 'subscription_time',
                    qs_gift_operation_id: operationId,
                    qs_gift_months: '1',
                    qs_gift_access_until: `${unixSeconds('2026-10-30T12:00:00Z')}`,
                },
            },
            expect.objectContaining({ idempotencyKey: expect.stringMatching(/^admin-subscription-gift-v1-/) }),
        );
        const updateParameters = mockStripeUpdate.mock.calls[0][1] as Record<string, unknown>;
        expect(updateParameters).not.toHaveProperty('items');
        expect(updateParameters).not.toHaveProperty('automatic_tax');
        expect(updateParameters).not.toHaveProperty('default_tax_rates');
        expect(updateParameters).not.toHaveProperty('cancel_at_period_end');

        const mailDocuments = [...db.store.entries()].filter(([path]) => path.startsWith('mail/'));
        expect(mailDocuments).toHaveLength(1);
        expect(JSON.stringify(mailDocuments[0][1])).toContain('subscription_time_gift');
        expect(JSON.stringify(mailDocuments[0][1])).not.toContain('Thank-you gift');
        expect(mailDocuments[0][1]).toMatchObject({ toUids: ['target-user'] });
    });

    it('keeps notification optional and does not queue mail when disabled', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 3 }));
        const response = await grantGift(callableRequest({
            uid: 'target-user',
            months: 3,
            reason: 'Service recovery credit',
            notifyUser: false,
            operationId,
            previewVersion: preview.previewVersion,
        }));

        expect(response.status).toBe('succeeded');
        expect(response.notificationStatus).toBe('not_requested');
        expect([...db.store.keys()].some(path => path.startsWith('mail/'))).toBe(false);
    });

    it('deduplicates Stripe updates and mail when the same successful operation is retried', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        const request = callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: true,
            operationId,
            previewVersion: preview.previewVersion,
        });

        const first = await grantGift(request);
        const second = await grantGift(request);

        expect(first.status).toBe('succeeded');
        expect(second.status).toBe('succeeded');
        expect(mockStripeUpdate).toHaveBeenCalledTimes(1);
        expect([...db.store.keys()].filter(path => path.startsWith('mail/'))).toHaveLength(1);
    });

    it('persists definitive Stripe failures without blocking a later operation', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        mockStripeUpdate.mockRejectedValueOnce({
            type: 'StripeInvalidRequestError',
            statusCode: 400,
        });
        const response = await grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: false,
            operationId,
            previewVersion: preview.previewVersion,
        }));

        expect(response.status).toBe('failed');

        const secondPreview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        const second = await grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Second attempt',
            notifyUser: false,
            operationId: secondOperationId,
            previewVersion: secondPreview.previewVersion,
        }));
        expect(second.status).toBe('succeeded');
    });

    it('fails safely when Stripe cannot verify the subscription after acquiring the lock', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        mockStripeRetrieve
            .mockResolvedValueOnce(currentSubscription)
            .mockRejectedValueOnce({ type: 'StripeConnectionError' });

        const response = await grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: true,
            operationId,
            previewVersion: preview.previewVersion,
        }));

        expect(response.status).toBe('failed');
        expect(response.notificationStatus).toBe('not_requested');
        expect(mockStripeUpdate).not.toHaveBeenCalled();
        expect(db.store.get(`users/target-user/adminSubscriptionGifts/${operationId}`))
            .toMatchObject({ status: 'failed', resultCode: 'stripe_subscription_read_failed' });
        expect(db.store.get('users/target-user/adminSubscriptionGiftState/lock'))
            .toMatchObject({ status: 'idle', operationId });
    });

    it('marks ambiguous Stripe outcomes for review and blocks new grants', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        mockStripeUpdate.mockRejectedValueOnce({ type: 'StripeConnectionError' });
        const first = await grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: false,
            operationId,
            previewVersion: preview.previewVersion,
        }));
        expect(first.status).toBe('needs_review');

        const nextPreview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        await expect(grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Another gift',
            notifyUser: false,
            operationId: secondOperationId,
            previewVersion: nextPreview.previewVersion,
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('blocks a new operation behind an expired applying lock until the original operation is reconciled', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        db.store.set('users/target-user/adminSubscriptionGiftState/lock', {
            status: 'applying',
            operationId,
            leaseToken: 'expired-lease',
            leaseExpiresAt: new Date('2026-08-30T11:59:00Z'),
        });

        await expect(grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Another gift',
            notifyUser: false,
            operationId: secondOperationId,
            previewVersion: preview.previewVersion,
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockStripeUpdate).not.toHaveBeenCalled();
    });

    it('reconciles an ambiguous retry when Stripe shows the stored operation was applied', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        const grantRequest = callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: false,
            operationId,
            previewVersion: preview.previewVersion,
        });
        mockStripeUpdate.mockRejectedValueOnce({ type: 'StripeConnectionError' });
        expect((await grantGift(grantRequest)).status).toBe('needs_review');

        const target = unixSeconds('2026-10-30T12:00:00Z');
        currentSubscription = buildSubscription({
            status: 'trialing',
            trial_end: target,
            metadata: {
                firebaseUID: 'target-user',
                retained: 'yes',
                qs_gift_type: 'subscription_time',
                qs_gift_operation_id: operationId,
                qs_gift_months: '1',
                qs_gift_access_until: `${target}`,
            },
            items: {
                ...currentSubscription.items,
                data: currentSubscription.items.data.map(item => ({ ...item, current_period_end: target })),
            },
        });

        const retried = await grantGift(grantRequest);
        expect(retried.status).toBe('succeeded');
        expect(mockStripeUpdate).toHaveBeenCalledTimes(1);
    });

    it('moves to review when the subscription changes between locking and Stripe update', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        const changed = buildSubscription({ trial_end: unixSeconds('2026-10-15T12:00:00Z') });
        mockStripeRetrieve
            .mockResolvedValueOnce(currentSubscription)
            .mockResolvedValueOnce(changed);

        const response = await grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: false,
            operationId,
            previewVersion: preview.previewVersion,
        }));

        expect(response.status).toBe('needs_review');
        expect(mockStripeUpdate).not.toHaveBeenCalled();
    });

    it('does not roll back a successful gift when the user has no notification email', async () => {
        const preview = await previewGift(callableRequest({ uid: 'target-user', months: 1 }));
        mockAuthGetUser.mockImplementation(async (uid: string) => ({
            uid,
            email: undefined,
            customClaims: { stripeRole: 'basic' },
        }));

        const response = await grantGift(callableRequest({
            uid: 'target-user',
            months: 1,
            reason: 'Thank-you gift',
            notifyUser: true,
            operationId,
            previewVersion: preview.previewVersion,
        }));

        expect(response.status).toBe('succeeded');
        expect(response.notificationStatus).toBe('failed');
        expect(mockStripeUpdate).toHaveBeenCalledTimes(1);
    });
});
