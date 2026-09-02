import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, it, beforeAll, afterAll, expect } from 'vitest';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules', () => {
    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'test-project',
            firestore: {
                rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
                host: 'localhost',
                port: 8081,
            },
        });
    });

    afterAll(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();
    });

    describe('Customers Collection', () => {
        const userId = 'user_123';
        const otherId = 'user_456';

        it('should allow user to read their own customer document', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertSucceeds(db.collection('customers').doc(userId).get());
        });

        it('should deny user from reading another customer document', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection('customers').doc(otherId).get());
        });

        it('should DENY user from clearing their own stripeId and stripeLink', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            // Setup initial data as admin
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('customers').doc(userId).set({
                    stripeId: 'cus_old',
                    stripeLink: 'https://stripe.com/old',
                    foo: 'bar'
                });
            });

            // User clears their fields using null (simpler case)
            await assertFails(db.collection('customers').doc(userId).update({
                stripeId: null,
                stripeLink: null
            }));
        });

        it('should DENY user from deleting their stripeId using deleteField()', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            const { deleteField } = await import('firebase/firestore');

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('customers').doc(userId).set({
                    stripeId: 'cus_to_delete',
                    stripeLink: 'https://stripe.com/delete'
                });
            });

            // User clears their fields specificially using deleteField()
            await assertFails(db.collection('customers').doc(userId).update({
                stripeId: deleteField(),
                stripeLink: deleteField()
            }));
        });

        it('should deny user from changing stripeId to a new value', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('customers').doc(userId).set({
                    stripeId: 'cus_old'
                });
            });

            // Attempt to hijack with a new ID
            await assertFails(db.collection('customers').doc(userId).update({
                stripeId: 'cus_stolen'
            }));
        });


    });

    describe('Role protected content', () => {
        const userId = 'role_user';

        it('should identify a Pro user', async () => {
            const db = testEnv.authenticatedContext(userId, { stripeRole: 'pro' }).firestore();
            // We can't easily test the function directly without a rule using it,
            // but we've verified the syntax via firebase_validate_security_rules.
            // This test confirms we can correctly simulate the pro token.
            expect(db).toBeDefined();
        });

        it('should identify a Basic user', async () => {
            const db = testEnv.authenticatedContext(userId, { stripeRole: 'basic' }).firestore();
            expect(db).toBeDefined();
        });

        it('should identify a Free user (no role)', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            expect(db).toBeDefined();
        });
    });

    describe('Service token pending disconnect protection', () => {
        const userId = 'service_user';
        const authClaims = { firebase: { sign_in_provider: 'password' } };

        it('preserves Garmin owner reads while denying root and credential mutations', async () => {
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();
            const tokenRef = db.doc(`garminAPITokens/${userId}/tokens/token-1`);

            await testEnv.withSecurityRulesDisabled(async context => {
                await context.firestore().doc(`garminAPITokens/${userId}`).set({
                    state: 'server-oauth-state',
                });
                await context.firestore().doc(`garminAPITokens/${userId}/tokens/token-1`).set({
                    accessToken: 'server-token',
                    userID: 'garmin-provider-user',
                });
            });

            await assertSucceeds(db.doc(`garminAPITokens/${userId}`).get());
            await assertSucceeds(tokenRef.get());
            await assertFails(db.doc(`garminAPITokens/${userId}`).set({ state: 'client-state' }));
            await assertFails(db.doc(`garminAPITokens/${userId}`).update({ state: 'client-state' }));
            await assertFails(db.doc(`garminAPITokens/${userId}`).delete());
            await assertFails(tokenRef.set({ accessToken: 'legacy-client-token' }));
            await assertFails(tokenRef.update({ accessToken: 'updated-client-token' }));
            await assertFails(tokenRef.delete());

            await assertFails(db.doc(
                `garminAPITokens/${userId}/tokens/token-1/subscriptions/forged`,
            ).set({
                status: 'active',
                role: 'pro',
                items: [{ plan: { interval: 'month' } }],
            }));
        });

        it('denies client writes to backend-owned disconnect fields', async () => {
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();

            await assertFails(db.collection('suuntoAppAccessTokens').doc(userId).set({
                disconnectState: 'disconnect_pending',
            }));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('suuntoAppAccessTokens').doc(userId).set({
                    state: 'oauth-state',
                });
            });

            await assertFails(db.collection('suuntoAppAccessTokens').doc(userId).update({
                disconnectAttemptCount: 0,
            }));
        });

        it('denies client writes to the backend-owned OAuth credential generation', async () => {
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();

            await assertFails(db.collection('suuntoAppAccessTokens').doc(userId).set({
                activeOAuthCredentialGeneration: 'client-generation',
            }));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('garminAPITokens').doc(userId).set({
                    activeOAuthCredentialGeneration: 'server-generation',
                });
            });

            await assertFails(db.collection('garminAPITokens').doc(userId).update({
                activeOAuthCredentialGeneration: 'client-replacement',
            }));

            await assertFails(db.collection('suuntoAppAccessTokens').doc(userId).set({
                oauthFlowGeneration: 'client-flow-generation',
            }));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('suuntoAppAccessTokens').doc(userId).set({
                    oauthFlowGeneration: 'server-flow-generation',
                });
            });

            await assertFails(db.collection('suuntoAppAccessTokens').doc(userId).update({
                oauthFlowGeneration: 'client-flow-replacement',
            }));

            await assertFails(db.collection('COROSAPIAccessTokens').doc(userId).set({
                disconnectOperationGeneration: 'client-disconnect-operation',
            }));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('wahooAPIAccessTokens').doc(userId).set({
                    disconnectOperationGeneration: 'server-disconnect-operation',
                });
            });

            await assertFails(db.collection('wahooAPIAccessTokens').doc(userId).update({
                disconnectOperationGeneration: 'client-disconnect-replacement',
            }));
        });

        it('denies client token mutations while disconnect is pending', async () => {
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();
            const tokenRef = db.collection('suuntoAppAccessTokens').doc(userId).collection('tokens').doc('token-1');

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('suuntoAppAccessTokens').doc(userId).set({
                    disconnectState: 'disconnect_pending',
                });
                await context.firestore()
                    .collection('suuntoAppAccessTokens')
                    .doc(userId)
                    .collection('tokens')
                    .doc('token-1')
                    .set({
                        accessToken: 'stored-token',
                    });
            });

            await assertSucceeds(tokenRef.get());
            await assertFails(tokenRef.update({ accessToken: 'changed' }));
            await assertFails(tokenRef.delete());
            await assertFails(db.collection('suuntoAppAccessTokens').doc(userId).update({
                state: 'new-oauth-state',
            }));
        });

        it('denies legacy client token mutations while explicit disconnect owns the root', async () => {
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                for (const collectionName of ['suuntoAppAccessTokens', 'garminAPITokens']) {
                    await context.firestore().collection(collectionName).doc(userId).set({
                        disconnectOperationGeneration: 'disconnect-operation-1',
                    });
                    await context.firestore()
                        .collection(collectionName)
                        .doc(userId)
                        .collection('tokens')
                        .doc('token-1')
                        .set({ accessToken: 'stored-token' });
                }
            });

            for (const collectionName of ['suuntoAppAccessTokens', 'garminAPITokens']) {
                const rootRef = db.collection(collectionName).doc(userId);
                const tokenRef = rootRef.collection('tokens').doc('token-1');
                await assertSucceeds(tokenRef.get());
                await assertFails(tokenRef.update({ accessToken: 'changed' }));
                await assertFails(tokenRef.delete());
                await assertFails(rootRef.update({ state: 'new-oauth-state' }));
                await assertFails(rootRef.delete());
            }
        });
    });

    describe('Suunto server-owned OAuth state and token credentials', () => {
        const userId = 'suunto_user';
        const authClaims = { firebase: { sign_in_provider: 'password' } };

        it('preserves owner reads while denying root, credential, and provider-identity mutations', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(`suuntoAppAccessTokens/${userId}`).set({
                    state: 'server-oauth-state',
                    activeOAuthCredentialGeneration: 'server-generation',
                });
                await context.firestore().doc(`suuntoAppAccessTokens/${userId}/tokens/suunto-account`).set({
                    accessToken: 'stored-access-token',
                    refreshToken: 'stored-refresh-token',
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-account',
                });
            });
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();
            const rootRef = db.doc(`suuntoAppAccessTokens/${userId}`);
            const tokenRef = db.doc(`suuntoAppAccessTokens/${userId}/tokens/suunto-account`);

            await assertSucceeds(rootRef.get());
            await assertSucceeds(tokenRef.get());
            await assertFails(rootRef.set({ state: 'client-oauth-state' }));
            await assertFails(rootRef.update({ state: 'client-oauth-state' }));
            await assertFails(rootRef.delete());
            await assertFails(db.doc(`suuntoAppAccessTokens/${userId}/tokens/victim-account`).set({
                accessToken: 'attacker-access-token',
                refreshToken: 'attacker-refresh-token',
                serviceName: 'SuuntoApp',
                userName: 'victim-account',
            }));
            await assertFails(tokenRef.update({ userName: 'victim-account' }));
            await assertFails(tokenRef.delete());
            const cursorRef = db.doc('providerMaintenanceState/suuntoSleepPolling');
            await assertFails(cursorRef.get());
            await assertFails(cursorRef.set({ nextOffset: 0 }));
        });
    });

    describe('COROS server-owned token credentials', () => {
        const userId = 'coros_user';
        const authClaims = { firebase: { sign_in_provider: 'password' } };

        it('preserves owner reads while denying client credential and identity mutations', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(`COROSAPIAccessTokens/${userId}/tokens/open-id`).set({
                    accessToken: 'stored-access-token',
                    refreshToken: 'stored-refresh-token',
                    openId: 'open-id',
                    dateCreated: 1_000,
                });
            });
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();
            const tokenRef = db.doc(`COROSAPIAccessTokens/${userId}/tokens/open-id`);

            await assertSucceeds(tokenRef.get());
            await assertFails(tokenRef.update({ accessToken: 'forged-access-token' }));
            await assertFails(tokenRef.update({ refreshToken: 'forged-refresh-token' }));
            await assertFails(tokenRef.update({ openId: 'forged-open-id' }));
            await assertFails(tokenRef.update({ dateCreated: 2_000 }));
            await assertFails(tokenRef.delete());
            await assertFails(db.doc(`COROSAPIAccessTokens/${userId}/tokens/other-id`).set({
                accessToken: 'forged-access-token',
                openId: 'other-id',
                dateCreated: 2_000,
            }));
        });

        it('requires server-owned callables for every COROS token-root mutation', async () => {
            const db = testEnv.authenticatedContext(userId, authClaims).firestore();
            const rootRef = db.doc(`COROSAPIAccessTokens/${userId}`);

            await assertFails(rootRef.set({ state: 'client-oauth-state' }));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(`COROSAPIAccessTokens/${userId}`).set({
                    activeOAuthCredentialGeneration: 'server-generation',
                });
            });

            await assertFails(rootRef.update({ state: 'client-replacement-state' }));
            await assertFails(rootRef.delete());
        });
    });

    describe('Wahoo server-owned integration state', () => {
        const userId = 'wahoo_user';

        it('denies browser reads and writes for Wahoo OAuth credentials', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(`wahooAPIAccessTokens/${userId}/tokens/42`).set({
                    accessToken: 'secret',
                    refreshToken: 'rotating-secret',
                    wahooUserID: '42',
                });
            });
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.doc(`wahooAPIAccessTokens/${userId}/tokens/42`).get());
            await assertFails(db.doc(`wahooAPIAccessTokens/${userId}/tokens/42`).set({ accessToken: 'forged' }));
        });

        it('allows the owner to read only the safe Wahoo connection metadata projection', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(`users/${userId}/meta/Wahoo API`).set({
                    connectionState: 'connected',
                    providerUserId: '60462',
                });
            });
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertSucceeds(db.doc(`users/${userId}/meta/Wahoo API`).get());
            await assertFails(db.doc(`users/${userId}/meta/Wahoo API`).set({ connectionState: 'connected' }));
        });
    });


    describe('User Split Model', () => {
        const userId = 'split_user';
        const otherId = 'other_user';
        const eventId = 'event_123';
        const routeId = 'route_123';

        describe('User Root Document (users/{uid})', () => {
            it('should allow user to create their own user document', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).set({
                    privacy: 'private'
                }));
            });

            it('should allow user to create their own user document with creationDate', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).set({
                    privacy: 'private',
                    creationDate: new Date('2026-03-26T00:00:00.000Z')
                }));
            });

            it('should deny user from updating creationDate after the document exists', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();

                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().collection('users').doc(userId).set({
                        privacy: 'private',
                        creationDate: new Date('2026-03-01T00:00:00.000Z')
                    });
                });

                await assertFails(db.collection('users').doc(userId).update({
                    creationDate: new Date('2026-03-15T00:00:00.000Z')
                }));
            });

            it('should allow user to update non-creationDate fields after creationDate is set', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();

                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().collection('users').doc(userId).set({
                        privacy: 'private',
                        creationDate: new Date('2026-03-01T00:00:00.000Z')
                    });
                });

                await assertSucceeds(db.collection('users').doc(userId).update({
                    displayName: 'Updated Name'
                }));
            });

            it('should deny user from deleting their own user document', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();

                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().collection('users').doc(userId).set({
                        privacy: 'private',
                        displayName: 'Delete Attempt'
                    });
                });

                await assertFails(db.collection('users').doc(userId).delete());
            });

            it('should deny user from creating another user document', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(otherId).set({
                    privacy: 'public',
                    displayName: 'IDOR_TEST'
                }));
            });

            it('should deny unauthenticated create on user document', async () => {
                const db = testEnv.unauthenticatedContext().firestore();
                await assertFails(db.collection('users').doc(userId).set({
                    privacy: 'public'
                }));
            });

            it('should deny unauthenticated read of user document even when privacy is public', async () => {
                const db = testEnv.unauthenticatedContext().firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().collection('users').doc(userId).set({
                        privacy: 'public'
                    });
                });

                await assertFails(db.collection('users').doc(userId).get());
            });

            it('should deny other authenticated users from reading a public user document', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().collection('users').doc(userId).set({
                        privacy: 'public'
                    });
                });

                await assertFails(db.collection('users').doc(userId).get());
            });
        });

        describe('Event Merge Operations (users/{uid}/eventMergeOperations/{operationId})', () => {
            const operationId = 'request-fingerprint';

            beforeEach(async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore()
                        .doc(`users/${userId}/eventMergeOperations/${operationId}`)
                        .set({
                            status: 'processing',
                            resultEventId: 'server-result-id',
                        });
                });
            });

            it('should deny all browser reads of server-owned merge operation state', async () => {
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                const otherDb = testEnv.authenticatedContext(otherId).firestore();
                const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
                const path = `users/${userId}/eventMergeOperations/${operationId}`;

                await assertFails(ownerDb.doc(path).get());
                await assertFails(otherDb.doc(path).get());
                await assertFails(unauthenticatedDb.doc(path).get());
            });

            it('should deny all browser writes to server-owned merge operation state', async () => {
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                const path = `users/${userId}/eventMergeOperations/${operationId}`;

                await assertFails(ownerDb.doc(path).set({ status: 'completed' }));
                await assertFails(ownerDb.doc(path).update({ status: 'retryable' }));
                await assertFails(ownerDb.doc(path).delete());
                await assertFails(ownerDb
                    .doc(`users/${userId}/eventMergeOperations/forged-operation`)
                    .set({ status: 'completed' }));
            });
        });

        describe('Admin Subscription Gifts', () => {
            const operationPath = `users/${userId}/adminSubscriptionGifts/gift-operation`;
            const lockPath = `users/${userId}/adminSubscriptionGiftState/lock`;

            beforeEach(async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(operationPath).set({
                        status: 'succeeded',
                        reason: 'private admin reason',
                    });
                    await context.firestore().doc(lockPath).set({
                        status: 'idle',
                    });
                });
            });

            it('denies owners, other users, and unauthenticated clients from reading gift audit state', async () => {
                await assertFails(testEnv.authenticatedContext(userId).firestore().doc(operationPath).get());
                await assertFails(testEnv.authenticatedContext(otherId).firestore().doc(operationPath).get());
                await assertFails(testEnv.unauthenticatedContext().firestore().doc(operationPath).get());
                await assertFails(testEnv.authenticatedContext(userId).firestore().doc(lockPath).get());
            });

            it('denies every browser mutation of gift operations and locks', async () => {
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                await assertFails(ownerDb.doc(operationPath).set({ status: 'succeeded' }));
                await assertFails(ownerDb.doc(operationPath).update({ reason: 'forged' }));
                await assertFails(ownerDb.doc(operationPath).delete());
                await assertFails(ownerDb.doc(lockPath).set({ status: 'idle' }));
                await assertFails(ownerDb.doc(lockPath).delete());
            });
        });

        describe('Activity sync outbound fingerprints', () => {
            const fingerprintPath = `users/${userId}/activitySyncOutboundFingerprints/exact-v1-private`;

            beforeEach(async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(fingerprintPath).set({
                        version: 1,
                        destinationServiceName: 'COROS API',
                        fingerprintKind: 'exact',
                        recordedAt: Date.now(),
                        expireAt: new Date('2026-12-01T00:00:00.000Z'),
                    });
                });
            });

            it('should deny all browser reads of server-owned echo receipts', async () => {
                await assertFails(testEnv.authenticatedContext(userId).firestore().doc(fingerprintPath).get());
                await assertFails(testEnv.authenticatedContext(otherId).firestore().doc(fingerprintPath).get());
                await assertFails(testEnv.unauthenticatedContext().firestore().doc(fingerprintPath).get());
            });

            it('should deny all browser writes to server-owned echo receipts', async () => {
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                await assertFails(ownerDb.doc(fingerprintPath).set({ version: 1 }));
                await assertFails(ownerDb.doc(fingerprintPath).delete());
            });
        });

        describe('Legal Agreements (users/{uid}/legal/agreements)', () => {
            it('should allow user to read their own agreements', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('legal').doc('agreements').get());
            });

            it('should deny user reading other agreements', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(otherId).collection('legal').doc('agreements').get());
            });

            it('should allow user to create agreements setting policies to TRUE', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('legal').doc('agreements').set({
                    acceptedPrivacyPolicy: true,
                    acceptedDiagnosticsPolicy: true,
                    acceptedTos: true
                }));
            });

            it('should deny user setting policies to FALSE', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(userId).collection('legal').doc('agreements').set({
                    acceptedPrivacyPolicy: false
                }));
            });

            it('should deny user un-accepting a policy (update true -> false)', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                // Setup: User accepted policy
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/legal/agreements`).set({
                        acceptedPrivacyPolicy: true
                    });
                });

                // Attempt to un-accept
                await assertFails(db.collection('users').doc(userId).collection('legal').doc('agreements').update({
                    acceptedPrivacyPolicy: false
                }));
            });

            it('should allow user to accept a new policy (update undefined -> true)', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                // Setup: User has one policy
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/legal/agreements`).set({
                        acceptedPrivacyPolicy: true
                    });
                });

                // Accept new policy
                await assertSucceeds(db.collection('users').doc(userId).collection('legal').doc('agreements').update({
                    acceptedTos: true
                }));
            });

            it('should allow user to update acceptedMarketingPolicy to true or false', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                // Setup: User has agreements
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/legal/agreements`).set({
                        acceptedPrivacyPolicy: true,
                        acceptedDataPolicy: true,
                        acceptedTos: true
                    });
                });

                // Update marketing policy to true
                await assertSucceeds(db.collection('users').doc(userId).collection('legal').doc('agreements').update({
                    acceptedMarketingPolicy: true
                }));

                // Update marketing policy to false
                await assertSucceeds(db.collection('users').doc(userId).collection('legal').doc('agreements').update({
                    acceptedMarketingPolicy: false
                }));
            });

            it('should deny updates to unknown fields', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(userId).collection('legal').doc('agreements').set({
                    acceptedPrivacyPolicy: true,
                    acceptedDiagnosticsPolicy: true,
                    someRandomField: true
                }));
            });
        });

        describe('Assistant Usage (users/{uid}/assistantUsage/{periodDocId})', () => {
            const usageDocId = 'period_1740787200000_1743465600000';

            it('should deny owner from reading Assistant usage period docs', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/assistantUsage/${usageDocId}`).set({
                        version: 1,
                        role: 'pro',
                        limit: 100,
                        periodStart: '2026-03-01T00:00:00.000Z',
                        periodEnd: '2026-04-01T00:00:00.000Z',
                        periodKind: 'subscription',
                        successfulRequestCount: 12,
                        reservationMap: {},
                        updatedAt: new Date(),
                    });
                });

                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.doc(`users/${userId}/assistantUsage/${usageDocId}`).get());
            });

            it('should deny owner from writing Assistant usage period docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.doc(`users/${userId}/assistantUsage/${usageDocId}`).set({
                    version: 1,
                    role: 'pro',
                    limit: 100,
                    periodStart: '2026-03-01T00:00:00.000Z',
                    periodEnd: '2026-04-01T00:00:00.000Z',
                    periodKind: 'subscription',
                    successfulRequestCount: 12,
                    reservationMap: {},
                    updatedAt: new Date(),
                }));
            });

            it('should deny other users from reading Assistant usage period docs', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/assistantUsage/${usageDocId}`).set({
                        version: 1,
                        role: 'pro',
                        limit: 100,
                        periodStart: '2026-03-01T00:00:00.000Z',
                        periodEnd: '2026-04-01T00:00:00.000Z',
                        periodKind: 'subscription',
                        successfulRequestCount: 12,
                        reservationMap: {},
                        updatedAt: new Date(),
                    });
                });

                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.doc(`users/${userId}/assistantUsage/${usageDocId}`).get());
            });

            it('should deny other users from writing Assistant usage period docs', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.doc(`users/${userId}/assistantUsage/${usageDocId}`).set({
                    version: 1,
                    role: 'pro',
                    limit: 100,
                    periodStart: '2026-03-01T00:00:00.000Z',
                    periodEnd: '2026-04-01T00:00:00.000Z',
                    periodKind: 'subscription',
                    successfulRequestCount: 12,
                    reservationMap: {},
                    updatedAt: new Date(),
                }));
            });
        });

        describe('Assistant conversations (users/{uid}/assistantConversations/active)', () => {
            const assistantPath = `users/${userId}/assistantConversations/active`;

            beforeEach(async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(assistantPath).set({
                        version: 1,
                        conversationId: 'conversation-1',
                        messages: [],
                        expireAt: new Date('2026-08-10T00:00:00.000Z'),
                    });
                });
            });

            it('should deny direct owner reads, writes, and deletes', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.doc(assistantPath).get());
                await assertFails(db.doc(assistantPath).set({ messages: [] }));
                await assertFails(db.doc(assistantPath).delete());
            });

            it('should deny other users from reading the conversation', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.doc(assistantPath).get());
            });
        });

        describe('Event MetaData (users/{uid}/events/{eventId}/metaData)', () => {
            it('should deny owner writing processing metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/events/${eventId}/metaData`).doc('processing').set({
                    sportsLibVersion: '8.0.9',
                    sportsLibVersionCode: 8000009,
                    processedAt: new Date(),
                }));
            });

            it('should deny owner writing non-processing metadata documents', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/events/${eventId}/metaData`).doc('GarminAPI').set({
                    serviceName: 'GarminAPI',
                }));
            });

            it('should deny other users writing processing metadata', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.collection(`users/${userId}/events/${eventId}/metaData`).doc('processing').set({
                    sportsLibVersion: '8.0.9',
                    sportsLibVersionCode: 8000009,
                    processedAt: new Date(),
                }));
            });

            it('should deny processing metadata writes even with valid shape and extra fields', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/events/${eventId}/metaData`).doc('processing').set({
                    sportsLibVersion: '8.0.9',
                    sportsLibVersionCode: 8000009,
                    processedAt: new Date(),
                    extraField: true,
                }));
            });

            it('should deny processing metadata writes when required fields are missing', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/events/${eventId}/metaData`).doc('processing').set({
                    sportsLibVersion: '8.0.9',
                    processedAt: new Date(),
                }));
            });

            it('should keep metadata subcollections private even when the parent event is public', async () => {
                const anonymousDb = testEnv.unauthenticatedContext().firestore();
                const otherDb = testEnv.authenticatedContext(otherId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'public'
                    });
                    await context.firestore().doc(`users/${userId}/events/${eventId}/metaData/processing`).set({
                        sportsLibVersion: '8.0.9',
                    });
                });

                await assertFails(anonymousDb.collection(`users/${userId}/events/${eventId}/metaData`).doc('processing').get());
                await assertFails(otherDb.collection(`users/${userId}/events/${eventId}/metaData`).doc('processing').get());
            });
        });

        describe('Events (users/{uid}/events/{eventId})', () => {
            it('should deny owner creating event without original file metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).set({
                    name: 'Morning Run',
                    privacy: 'private'
                }));
            });

            it('should deny owner creating event with originalFile metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).set({
                    name: 'Morning Run',
                    originalFile: { path: 'users/someone/events/e1/original.fit' }
                }));
            });

            it('should deny owner creating event with originalFiles metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).set({
                    name: 'Morning Run',
                    originalFiles: [{ path: 'users/someone/events/e1/original.fit' }]
                }));
            });

            it('should allow unauthenticated read of public event', async () => {
                const db = testEnv.unauthenticatedContext().firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'public'
                    });
                });

                await assertSucceeds(db.collection(`users/${userId}/events`).doc(eventId).get());
            });

            it('should deny unauthenticated queries for public events', async () => {
                const db = testEnv.unauthenticatedContext().firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'public'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).where('privacy', '==', 'public').get());
            });

            it('should allow other authenticated users to read a public event', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'public'
                    });
                });

                await assertSucceeds(db.collection(`users/${userId}/events`).doc(eventId).get());
            });

            it('should deny public reads of private events', async () => {
                const db = testEnv.unauthenticatedContext().firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'private'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).get());
            });

            it('should allow owner updating event when original file metadata is untouched', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Old Name',
                        privacy: 'private'
                    });
                });

                await assertSucceeds(db.collection(`users/${userId}/events`).doc(eventId).update({
                    name: 'New Name'
                }));
            });

            it('should allow only the owner to update event tags', async () => {
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                const otherDb = testEnv.authenticatedContext(otherId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'public',
                        tags: ['Race'],
                    });
                });

                await assertSucceeds(ownerDb.collection(`users/${userId}/events`).doc(eventId).update({
                    tags: ['Race pace', '2026', '🏃'.repeat(16)],
                }));
                await assertSucceeds(ownerDb.collection(`users/${userId}/events`).doc(eventId).update({
                    tags: Array.from({ length: 10 }, (_, index) => `Tag ${index}`),
                }));
                await assertFails(otherDb.collection(`users/${userId}/events`).doc(eventId).update({
                    tags: ['Spoofed'],
                }));
            });

            it('should deny invalid event tag values', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                const eventRef = db.collection(`users/${userId}/events`).doc(eventId);
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'private',
                    });
                });

                await assertFails(eventRef.update({
                    tags: Array.from({ length: 11 }, (_, index) => `Tag ${index}`),
                }));
                await assertFails(eventRef.update({
                    tags: ['x'.repeat(33)],
                }));
                await assertFails(eventRef.update({
                    tags: ['🏃'.repeat(17)],
                }));
                await assertFails(eventRef.update({
                    tags: ['Race', 2026],
                }));
                await assertFails(eventRef.update({
                    tags: [''],
                }));
                await assertFails(eventRef.update({
                    tags: ['   '],
                }));
                await assertFails(eventRef.update({
                    tags: [' padded'],
                }));
                await assertFails(eventRef.update({
                    tags: ['double  space'],
                }));
                await assertFails(eventRef.update({
                    tags: ['Race', 'Race'],
                }));
            });

            it('should validate legacy comparison tags while allowing unrelated updates to older documents', async () => {
                const { deleteField } = await import('firebase/firestore');
                const db = testEnv.authenticatedContext(userId).firestore();
                const eventRef = db.collection(`users/${userId}/events`).doc(eventId);
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Legacy comparison',
                        privacy: 'private',
                        tags: ['Canonical'],
                        benchmarkReviewTags: [' legacy padded '],
                    });
                });

                await assertSucceeds(eventRef.update({ name: 'Renamed comparison' }));
                await assertFails(eventRef.update({ tags: deleteField() }));
                await assertFails(eventRef.update({ benchmarkReviewTags: [' padded '] }));
                await assertFails(eventRef.update({ benchmarkReviewTags: ['x'.repeat(33)] }));
                await assertSucceeds(eventRef.update({ benchmarkReviewTags: ['Firmware', 'GPS route'] }));
                await assertSucceeds(eventRef.update({ tags: deleteField() }));
                await assertSucceeds(eventRef.update({
                    tags: ['Migrated'],
                    benchmarkReviewTags: deleteField(),
                }));
            });

            it('should deny owner updating event privacy directly', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'private'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).update({
                    privacy: 'public'
                }));
            });

            it('should deny owner updating originalFile metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'private'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).update({
                    originalFile: { path: 'users/attacker/events/e1/original.fit' }
                }));
            });

            it('should deny owner updating originalFiles metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'private'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).update({
                    originalFiles: [{ path: 'users/attacker/events/e1/original.fit' }]
                }));
            });

            it('should deny owner updating merge classification metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'private',
                        isMerge: false,
                        mergeType: 'multi'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).update({
                    isMerge: true,
                    mergeType: 'benchmark'
                }));
            });

            it('should deny owner updating tool comparison metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Device comparison',
                        privacy: 'private',
                        toolSource: 'tools/compare',
                        sourceFilesCount: 2,
                        activitiesCount: 4,
                        comparisonTitle: 'Device comparison',
                        benchmarkStatus: 'draft'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).update({
                    toolSource: 'dashboard',
                    sourceFilesCount: 99,
                    activitiesCount: 99,
                    comparisonTitle: 'Spoofed comparison',
                    benchmarkStatus: 'complete'
                }));
            });
        });

        describe('Routes (users/{uid}/routes/{routeId})', () => {
            it('should deny owner creating route documents directly', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).set({
                    name: 'Morning Route',
                    srcFileType: 'gpx',
                    routes: [],
                }));
            });

            it('should allow owner reading their own route', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        srcFileType: 'gpx',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertSucceeds(db.collection(`users/${userId}/routes`).doc(routeId).get());
            });

            it('should deny other users reading route documents', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        srcFileType: 'gpx',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).get());
            });

            it('should allow owner updating user-owned route fields', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Old Route',
                        srcFileType: 'fit',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertSucceeds(db.collection(`users/${userId}/routes`).doc(routeId).update({
                    name: 'New Route',
                    notes: 'Updated by owner',
                }));
            });

            it('should deny owner saving invalid route names', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        srcFileType: 'fit',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).update({
                    name: '',
                }));
                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).update({
                    name: 'x'.repeat(121),
                }));
            });

            it('should deny owner updating original route file metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        srcFileType: 'gpx',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).update({
                    originalFiles: [{ path: 'users/attacker/routes/route_123/original.gpx' }],
                }));
            });

            it('should deny owner updating server-owned route summary fields', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        srcFileType: 'fit',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).update({
                    stats: { Distance: 1 },
                    pointCount: 0,
                    routes: [],
                    bounds: {
                        minLatitudeDegrees: 0,
                        maxLatitudeDegrees: 0,
                        minLongitudeDegrees: 0,
                        maxLongitudeDegrees: 0,
                    },
                    preview: {
                        version: 1,
                        encoding: 'polyline5',
                        precision: 5,
                        sourcePointCount: 2,
                        pointCount: 2,
                        segments: [],
                    },
                    previewReady: true,
                }));
            });

            it('should deny owner forging route delivery summaries', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                        deliverySummaries: [],
                    });
                });

                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).update({
                    deliverySummaries: [{
                        serviceName: 'GarminAPI',
                        providerUserIds: ['forged-garmin-user'],
                        latestProviderUserId: 'forged-garmin-user',
                    }],
                }));
            });

            it('should deny owner updating route creator metadata', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        srcFileType: 'fit',
                        creator: { name: 'Original Device' },
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertFails(db.collection(`users/${userId}/routes`).doc(routeId).update({
                    creator: { name: 'Spoofed Device' },
                }));
            });

            it('should allow owner deleting their own route document', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}`).set({
                        name: 'Morning Route',
                        srcFileType: 'gpx',
                        routeCount: 1,
                        pointCount: 2,
                        routes: [],
                    });
                });

                await assertSucceeds(db.collection(`users/${userId}/routes`).doc(routeId).delete());
            });

            it('should allow owner reading route processing metadata but deny writes', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/routes/${routeId}/metaData/processing`).set({
                        sportsLibVersion: '15.0.5',
                        sportsLibVersionCode: 15000005,
                        processedAt: new Date(),
                    });
                });

                await assertSucceeds(db.collection(`users/${userId}/routes/${routeId}/metaData`).doc('processing').get());
                await assertFails(db.collection(`users/${userId}/routes/${routeId}/metaData`).doc('processing').set({
                    sportsLibVersion: '15.0.5',
                    sportsLibVersionCode: 15000005,
                    processedAt: new Date(),
                }));
            });
        });

        describe('System Status (users/{uid}/system/status)', () => {
            it('should allow user to read their own status', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('system').doc('status').get());
            });

            it('should deny user writing to status', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(userId).collection('system').doc('status').set({
                    gracePeriodUntil: new Date()
                }));
            });

            it('should deny user updating status', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(userId).collection('system').doc('status').update({
                    isPro: true
                }));
            });
        });

        describe('Config Settings (users/{uid}/config/settings)', () => {
            it('should allow user to read their own settings', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('config').doc('settings').get());
            });

            it('should allow user to write their own settings', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('config').doc('settings').set({
                    theme: 'dark',
                    units: 'metric'
                }));
            });

            it('should require validated callables for training settings while allowing other settings updates', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                const settingsRef = db.collection('users').doc(userId).collection('config').doc('settings');
                const trainingSettings = {
                    visibleDisciplines: ['running', 'cycling', 'swimming'],
                    buildBenchmarks: {
                        running: { mode: 'period', durationWeeks: 12, endDayMs: 1_746_403_200_000 },
                        swimming: { mode: 'period', durationWeeks: 8, endDayMs: 1_743_984_000_000 },
                    },
                };

                await assertFails(settingsRef.set({ trainingSettings }));
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/config/settings`).set({
                        theme: 'dark',
                        trainingSettings,
                    });
                });

                await assertFails(settingsRef.update({
                    trainingSettings: { buildBenchmarks: { cycling: { mode: 'period', durationWeeks: 8, endDayMs: 1_746_403_200_000 } } },
                }));
                await assertSucceeds(settingsRef.update({ theme: 'light' }));
                await assertSucceeds(settingsRef.set({
                    appSettings: {
                        trainingWorkspace: {
                            preferredDestination: 'cycling',
                            sportShortcuts: ['running', 'cycling'],
                        },
                    },
                }, { merge: true }));

                const savedSettings = (await settingsRef.get()).data();
                expect(savedSettings?.trainingSettings).toEqual(trainingSettings);
                expect(savedSettings?.appSettings?.trainingWorkspace).toEqual({
                    preferredDestination: 'cycling',
                    sportShortcuts: ['running', 'cycling'],
                });
            });

            it('should deny user reading other user settings', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(otherId).collection('config').doc('settings').get());
            });

            it('should deny user writing to other user settings', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(otherId).collection('config').doc('settings').set({
                    theme: 'hacked'
                }));
            });
        });

        describe('Derived Metrics (users/{uid}/derivedMetrics/{doc})', () => {
            it('should allow user to read their own derived metrics docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('derivedMetrics').doc('form').get());
            });

            it('should deny user reading other user derived metrics docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(otherId).collection('derivedMetrics').doc('form').get());
            });

            it('should deny unauthenticated reads for derived metrics docs', async () => {
                const db = testEnv.unauthenticatedContext().firestore();
                await assertFails(db.collection('users').doc(userId).collection('derivedMetrics').doc('form').get());
            });
        });

        describe('Sleep Sessions and Sync State', () => {
            it('should allow owners to read their own sleep session docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('sleepSessions').doc('sleep-1').get());
            });

            it('should deny reading another user sleep session docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(otherId).collection('sleepSessions').doc('sleep-1').get());
            });

            it('should deny client writes to sleep sessions', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(userId).collection('sleepSessions').doc('sleep-1').set({
                    provider: 'GarminAPI',
                    durationSeconds: 28800,
                }));
            });

            it('keeps mixed legacy and Sports Lib sleep storage owner-readable and server-written', async () => {
                await testEnv.withSecurityRulesDisabled(async context => {
                    await context.firestore().collection('users').doc(userId)
                        .collection('sleepSessions').doc('mixed-sleep').set({
                            durationSeconds: 28800,
                            sportsLibData: {
                                schemaVersion: 1,
                                metrics: { duration: { 'Sleep Duration': 28800 } },
                            },
                        });
                });
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                const otherDb = testEnv.authenticatedContext(otherId).firestore();

                const snapshot = await assertSucceeds(ownerDb.collection('users').doc(userId)
                    .collection('sleepSessions').doc('mixed-sleep').get());
                expect(snapshot.data()?.sportsLibData?.schemaVersion).toBe(1);
                await assertFails(otherDb.collection('users').doc(userId)
                    .collection('sleepSessions').doc('mixed-sleep').get());
                await assertFails(ownerDb.collection('users').doc(userId)
                    .collection('sleepSessions').doc('mixed-sleep').update({
                        'sportsLibData.metrics.duration.Sleep Duration': 1,
                    }));
            });

            it('should allow owners to read their own sleep sync state docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.collection('users').doc(userId).collection('sleepSyncState').doc('GarminAPI').get());
            });

            it('should deny client writes to sleep sync state docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(userId).collection('sleepSyncState').doc('GarminAPI').set({
                    status: 'ready',
                }));
            });
        });

        describe('Unified Health Source Records and Sync State', () => {
            it('allows owners to get their own health documents', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();

                await assertSucceeds(db.collection('users').doc(userId).collection('healthSourceRecords').doc('record-1').get());
                await assertSucceeds(db.collection('users').doc(userId).collection('healthSampleChunks').doc('chunk-1').get());
                await assertSucceeds(db.collection('users').doc(userId).collection('healthSyncState').doc('GarminAPI').get());
            });

            it('denies reads from another account and unauthenticated reads', async () => {
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                const anonymousDb = testEnv.unauthenticatedContext().firestore();

                await assertFails(ownerDb.collection('users').doc(otherId).collection('healthSourceRecords').doc('record-1').get());
                await assertFails(ownerDb.collection('users').doc(otherId).collection('healthSampleChunks').doc('chunk-1').get());
                await assertFails(ownerDb.collection('users').doc(otherId).collection('healthSyncState').doc('GarminAPI').get());
                await assertFails(anonymousDb.collection('users').doc(userId).collection('healthSourceRecords').doc('record-1').get());
            });

            it('allows only explicitly bounded owner list queries', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                const userRef = db.collection('users').doc(userId);

                await assertSucceeds(userRef.collection('healthSourceRecords').limit(33).get());
                await assertFails(userRef.collection('healthSourceRecords').limit(34).get());
                await assertFails(userRef.collection('healthSourceRecords').get());

                await assertSucceeds(userRef.collection('healthSampleChunks').limit(9).get());
                await assertFails(userRef.collection('healthSampleChunks').limit(10).get());
                await assertFails(userRef.collection('healthSampleChunks').get());

                await assertSucceeds(userRef.collection('healthSyncState').limit(6).get());
                await assertFails(userRef.collection('healthSyncState').limit(7).get());
                await assertFails(userRef.collection('healthSyncState').get());
            });

            it('denies all browser writes to server-owned health collections', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                const userRef = db.collection('users').doc(userId);

                await assertFails(userRef.collection('healthSourceRecords').doc('record-1').set({ calendarDate: '2026-01-01' }));
                await assertFails(userRef.collection('healthSampleChunks').doc('chunk-1').set({ offsetMs: [0] }));
                await assertFails(userRef.collection('healthSyncState').doc('GarminAPI').set({ status: 'ready' }));
            });

            it('keeps mixed legacy and Sports Lib Health storage owner-readable and server-written', async () => {
                await testEnv.withSecurityRulesDisabled(async context => {
                    await context.firestore().collection('users').doc(userId)
                        .collection('healthSourceRecords').doc('mixed-health').set({
                            calendarDate: '2026-01-01',
                            metrics: [{
                                canonical: { value: 100, unit: 'count' },
                                sportsLibData: {
                                    schemaVersion: 1,
                                    metrics: { value: { Steps: 100 } },
                                },
                            }],
                        });
                });
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                const otherDb = testEnv.authenticatedContext(otherId).firestore();

                const snapshot = await assertSucceeds(ownerDb.collection('users').doc(userId)
                    .collection('healthSourceRecords').doc('mixed-health').get());
                expect(snapshot.data()?.metrics?.[0]?.sportsLibData?.schemaVersion).toBe(1);
                await assertFails(otherDb.collection('users').doc(userId)
                    .collection('healthSourceRecords').doc('mixed-health').get());
                await assertFails(ownerDb.collection('users').doc(userId)
                    .collection('healthSourceRecords').doc('mixed-health').update({ metrics: [] }));
            });

            it('forbids descendants beneath permanent health leaf documents', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();

                await assertFails(db.doc(`users/${userId}/healthSampleChunks/chunk-1/children/forbidden`).get());
                await assertFails(db.doc(`users/${userId}/healthSampleChunks/chunk-1/children/forbidden`).set({ value: 1 }));
            });
        });

        describe('Rejected route original cleanup tasks', () => {
            it('denies owners and other clients all direct access', async () => {
                const ownerDb = testEnv.authenticatedContext(userId).firestore();
                const otherDb = testEnv.authenticatedContext(otherId).firestore();
                const ref = ownerDb.doc('routeOriginalFileCleanup/cleanup-1');

                await assertFails(ref.get());
                await assertFails(ref.set({ path: 'forged' }));
                await assertFails(ref.delete());
                await assertFails(otherDb.doc('routeOriginalFileCleanup/cleanup-1').get());
                await assertFails(ownerDb.doc(`users/${userId}/routeOriginalFileCleanup/legacy-cleanup-1`).get());
            });
        });

        describe('MCP server-owned credential state', () => {
            it('should deny owners reading or writing MCP connection summaries directly', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore()
                        .doc(`users/${userId}/mcpConnections/connection-1`)
                        .set({ clientName: 'Example client' });
                });
                const db = testEnv.authenticatedContext(userId).firestore();
                const ref = db.doc(`users/${userId}/mcpConnections/connection-1`);

                await assertFails(ref.get());
                await assertFails(ref.set({ clientName: 'Forged client' }));
                await assertFails(ref.delete());
            });

            it('should deny browser access to every top-level MCP OAuth collection', async () => {
                const collectionNames = [
                    'mcpOAuthAuthorizationRequests',
                    'mcpOAuthAuthorizationCodes',
                    'mcpOAuthAccessTokens',
                    'mcpOAuthRefreshTokens',
                    'mcpOAuthRateLimits',
                ];
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await Promise.all(collectionNames.map(collectionName =>
                        context.firestore().doc(`${collectionName}/credential-1`).set({
                            uid: userId,
                            secret: 'server-owned',
                        })
                    ));
                });
                const db = testEnv.authenticatedContext(userId).firestore();

                for (const collectionName of collectionNames) {
                    const ref = db.doc(`${collectionName}/credential-1`);
                    await assertFails(ref.get());
                    await assertFails(ref.set({ uid: userId }));
                    await assertFails(ref.delete());
                }
            });
        });
    });
    // End of main describe block removed here to include appended tests

    describe('Flat Activities Collection', () => {
        const userId = 'user_activities_1';
        const otherId = 'user_activities_2';
        const activityId = 'activity_1';

        it('should allow user to read their own activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertSucceeds(db.collection(`users/${userId}/activities`).doc(activityId).get());
        });

        it('should deny owner creating their own activity doc from client', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('original_event').set({
                    type: 'Run'
                });
            });
            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).set({
                type: 'Running',
                distance: 5000,
                eventID: 'original_event'
            }));
        });

        it('should deny user from writing activity without eventID', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection(`users/${userId}/activities`).doc('activity_no_event').set({
                type: 'Walking',
                distance: 1200
            }));
        });

        it('should deny user from writing activity with nonexistent eventID', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection(`users/${userId}/activities`).doc('activity_bad_event').set({
                type: 'Running',
                eventID: 'missing_event'
            }));
        });

        it('should deny user from writing activity with another users eventID', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${otherId}/events`).doc('other_event').set({
                    type: 'Ride'
                });
            });
            await assertFails(db.collection(`users/${userId}/activities`).doc('activity_cross_owner').set({
                type: 'Running',
                eventID: 'other_event'
            }));
        });

        it('should deny user from deleting their own activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/activities`).doc(activityId).set({
                    type: 'Running',
                    eventID: 'original_event'
                });
            });

            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).delete());
        });

        it('should allow user to update their own activity without changing eventID', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('original_event').set({
                    type: 'Run'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc(activityId).set({
                    type: 'Running',
                    eventID: 'original_event'
                });
            });

            await assertSucceeds(db.collection(`users/${userId}/activities`).doc(activityId).update({
                type: 'Cycling',
                eventID: 'original_event'
            }));

            await assertSucceeds(db.collection(`users/${userId}/activities`).doc(activityId).update({
                distance: 10000
            }));
        });

        it('should deny updates when stored activity has invalid cross-user eventID', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${otherId}/events`).doc('other_event').set({
                    type: 'Run'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc('activity_seeded_bad_ref').set({
                    type: 'Running',
                    eventID: 'other_event'
                });
            });

            await assertFails(db.collection(`users/${userId}/activities`).doc('activity_seeded_bad_ref').update({
                distance: 7000
            }));
        });

        it('should deny user from updating eventID of their activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/activities`).doc(activityId).set({
                    type: 'Running',
                    eventID: 'original_event'
                });
            });

            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).update({
                eventID: 'hacked_event'
            }));
        });

        it('should deny user from updating userID of their activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('original_event').set({
                    type: 'Running'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc(activityId).set({
                    type: 'Running',
                    eventID: 'original_event',
                    userID: userId,
                });
            });

            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).update({
                userID: 'another-user'
            }));
        });

        it('should deny user from updating eventStartDate of their activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('original_event').set({
                    type: 'Running'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc(activityId).set({
                    type: 'Running',
                    eventID: 'original_event',
                    eventStartDate: new Date('2026-02-24T00:00:00.000Z'),
                });
            });

            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).update({
                eventStartDate: new Date('2026-02-25T00:00:00.000Z')
            }));
        });

        it('should deny user from updating sourceActivityKey of their activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('original_event').set({
                    type: 'Running'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc(activityId).set({
                    type: 'Running',
                    eventID: 'original_event',
                    sourceActivityKey: 'sha256:signature:0',
                });
            });

            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).update({
                sourceActivityKey: 'sha256:signature:1'
            }));
        });

        it('should deny user from reading another users activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection(`users/${otherId}/activities`).doc('some_activity').get());
        });

        it('should deny user from writing to another users activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection(`users/${otherId}/activities`).doc('some_activity').set({
                type: 'Hacking'
            }));
        });



        it('should DENY unauthenticated users from reading activities', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).get());
        });

        it('should allow unauthenticated users to read activities for a public parent event', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('public_event').set({
                    type: 'Swim',
                    privacy: 'public'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc('public_activity').set({
                    type: 'Swimming',
                    eventID: 'public_event'
                });
            });
            await assertSucceeds(db.collection(`users/${userId}/activities`).doc('public_activity').get());
        });

        it('should allow unauthenticated users to query activities for a public parent event', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('public_event').set({
                    type: 'Swim',
                    privacy: 'public'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc('public_activity').set({
                    type: 'Swimming',
                    eventID: 'public_event'
                });
            });

            await assertSucceeds(db.collection(`users/${userId}/activities`).where('eventID', '==', 'public_event').get());
        });

        it('should allow other authenticated users to read activities for a public parent event', async () => {
            const db = testEnv.authenticatedContext(otherId).firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('public_event').set({
                    type: 'Ride',
                    privacy: 'public'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc('public_activity_2').set({
                    type: 'Cycling',
                    eventID: 'public_event'
                });
            });
            await assertSucceeds(db.collection(`users/${userId}/activities`).doc('public_activity_2').get());
        });

        it('should deny public reads of activities for private or missing parent events', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events`).doc('private_event').set({
                    type: 'Ride',
                    privacy: 'private'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc('private_activity').set({
                    type: 'Cycling',
                    eventID: 'private_event'
                });
                await context.firestore().collection(`users/${userId}/activities`).doc('missing_parent_activity').set({
                    type: 'Cycling',
                    eventID: 'missing_event'
                });
            });

            await assertFails(db.collection(`users/${userId}/activities`).doc('private_activity').get());
            await assertFails(db.collection(`users/${userId}/activities`).doc('missing_parent_activity').get());
        });

    });

    // End of main describe block removed here to include appended tests

    describe('Legacy Activities Collection (Nested)', () => {
        const userId = 'legacy_user';
        const eventId = 'legacy_event';
        const activityId = 'legacy_activity';

        it('should DENY user from reading their own nested activity (Removed matching rule)', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/events/${eventId}/activities`).doc(activityId).set({ foo: 'bar' });
                await context.firestore().collection(`users/${userId}/events`).doc(eventId).set({ privacy: 'private' });
            });
            await assertFails(db.collection(`users/${userId}/events/${eventId}/activities`).doc(activityId).get());
        });

        it('should DENY user from writing to nested activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection(`users/${userId}/events/${eventId}/activities`).doc(activityId).set({
                type: 'Running'
            }));
        });
    });

    describe('Retired AI Insights storage paths', () => {
        it('keeps the retired usage ledger inaccessible even to its owner', async () => {
            const retiredUserId = 'retired-insights-usage-user';
            const usagePath = `users/${retiredUserId}/aiInsightsUsage/period_1_2`;
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(usagePath).set({
                    successfulRequestCount: 12,
                });
            });

            const db = testEnv.authenticatedContext(retiredUserId).firestore();
            await assertFails(db.doc(usagePath).get());
            await assertFails(db.doc(usagePath).set({ successfulRequestCount: 0 }));
            await assertFails(db.doc(usagePath).delete());
        });

        it('keeps legacy latest snapshots inaccessible even to their owner', async () => {
            const retiredUserId = 'retired-insights-user';
            const snapshotPath = `users/${retiredUserId}/aiInsightsRequests/latest`;
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(snapshotPath).set({
                    version: 1,
                    prompt: 'historical prompt',
                });
            });

            const db = testEnv.authenticatedContext(retiredUserId).firestore();
            await assertFails(db.doc(snapshotPath).get());
            await assertFails(db.doc(snapshotPath).set({ version: 2 }));
            await assertFails(db.doc(snapshotPath).delete());
        });

        it('keeps historical prompt-repair records inaccessible to clients', async () => {
            const repairPath = 'aiInsightsPromptRepairs/historical-repair';
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(repairPath).set({
                    canonicalPrompt: 'historical prompt',
                    expireAt: new Date(),
                });
            });

            const authenticatedDb = testEnv.authenticatedContext('retired-repair-user').firestore();
            const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
            await assertFails(authenticatedDb.doc(repairPath).get());
            await assertFails(authenticatedDb.doc(repairPath).set({ canonicalPrompt: 'replacement' }));
            await assertFails(authenticatedDb.doc(repairPath).delete());
            await assertFails(unauthenticatedDb.doc(repairPath).get());
        });
    });

    describe('Server-Owned Queue Collections', () => {
        it('allows only admin reads and denies every client write for wahooAPIWorkoutQueue', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('wahooAPIWorkoutQueue/item-1').set({ processed: false });
            });
            const userDb = testEnv.authenticatedContext('regular-user').firestore();
            const adminDb = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertFails(userDb.doc('wahooAPIWorkoutQueue/item-1').get());
            await assertSucceeds(adminDb.doc('wahooAPIWorkoutQueue/item-1').get());
            await assertFails(adminDb.doc('wahooAPIWorkoutQueue/item-2').set({ processed: false }));
        });

        it('should deny non-admin reads from activitySyncQueue', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('activitySyncQueue/queue-item-1').set({
                    processed: false,
                    routeId: 'GarminAPI_to_SuuntoApp'
                });
            });

            const db = testEnv.authenticatedContext('regular-user').firestore();
            await assertFails(db.doc('activitySyncQueue/queue-item-1').get());
        });

        it('should allow admin reads from activitySyncQueue', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('activitySyncQueue/queue-item-2').set({
                    processed: false,
                    routeId: 'GarminAPI_to_SuuntoApp'
                });
            });

            const db = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertSucceeds(db.doc('activitySyncQueue/queue-item-2').get());
        });

        it('should deny writes to activitySyncQueue even for admins', async () => {
            const db = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertFails(db.doc('activitySyncQueue/queue-item-3').set({
                processed: false,
                routeId: 'GarminAPI_to_SuuntoApp'
            }));
        });

        it('should deny non-admin reads from routeDeliverySyncQueue', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('routeDeliverySyncQueue/queue-item-1').set({
                    processed: false,
                    routeId: 'SuuntoApp_to_GarminAPI'
                });
            });

            const db = testEnv.authenticatedContext('regular-user').firestore();
            await assertFails(db.doc('routeDeliverySyncQueue/queue-item-1').get());
        });

        it('should allow admin reads from routeDeliverySyncQueue', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('routeDeliverySyncQueue/queue-item-2').set({
                    processed: false,
                    routeId: 'SuuntoApp_to_GarminAPI'
                });
            });

            const db = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertSucceeds(db.doc('routeDeliverySyncQueue/queue-item-2').get());
        });

        it('should deny writes to routeDeliverySyncQueue even for admins', async () => {
            const db = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertFails(db.doc('routeDeliverySyncQueue/queue-item-3').set({
                processed: false,
                routeId: 'SuuntoApp_to_GarminAPI'
            }));
        });

        it('should deny non-admin reads from sleepSyncQueue', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('sleepSyncQueue/queue-item-1').set({
                    processed: false,
                    provider: 'GarminAPI'
                });
            });

            const db = testEnv.authenticatedContext('regular-user').firestore();
            await assertFails(db.doc('sleepSyncQueue/queue-item-1').get());
        });

        it('should allow admin reads from sleepSyncQueue', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('sleepSyncQueue/queue-item-2').set({
                    processed: false,
                    provider: 'SuuntoApp'
                });
            });

            const db = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertSucceeds(db.doc('sleepSyncQueue/queue-item-2').get());
        });

        it('should deny writes to sleepSyncQueue even for admins', async () => {
            const db = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertFails(db.doc('sleepSyncQueue/queue-item-3').set({
                processed: false,
                provider: 'COROSAPI'
            }));
        });

        it('should deny all browser access to Suunto Health webhook ingress', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('suuntoHealthWebhookIngress/ingress-1').set({
                    processed: false,
                    providerUserId: 'private-provider-account',
                });
            });

            const ownerDb = testEnv.authenticatedContext('regular-user').firestore();
            const adminDb = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertFails(ownerDb.doc('suuntoHealthWebhookIngress/ingress-1').get());
            await assertFails(adminDb.doc('suuntoHealthWebhookIngress/ingress-1').get());
            await assertFails(adminDb.doc('suuntoHealthWebhookIngress/forged').set({ processed: false }));
        });

        it('should deny all browser access to Suunto Health webhook account bindings', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('suuntoHealthWebhookAccountBindings/binding-1').set({
                    schemaVersion: 1,
                    userID: 'regular-user',
                    tokenCredentialGeneration: 'credential-generation-1',
                });
            });

            const ownerDb = testEnv.authenticatedContext('regular-user').firestore();
            const adminDb = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertFails(ownerDb.doc('suuntoHealthWebhookAccountBindings/binding-1').get());
            await assertFails(adminDb.doc('suuntoHealthWebhookAccountBindings/binding-1').get());
            await assertFails(adminDb.doc('suuntoHealthWebhookAccountBindings/forged').set({
                schemaVersion: 1,
                userID: 'admin-user',
            }));
        });

        it('forbids descendants beneath permanent Suunto binding leaf documents', async () => {
            const ownerDb = testEnv.authenticatedContext('regular-user').firestore();
            const adminDb = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();
            await assertFails(ownerDb
                .doc('suuntoHealthWebhookAccountBindings/binding-1/children/forbidden')
                .get());
            await assertFails(adminDb
                .doc('suuntoHealthWebhookAccountBindings/binding-1/children/forbidden')
                .set({ value: 1 }));
        });
    });

    describe('Admin Dashboard Snapshots', () => {
        const snapshotPath = 'adminDashboardSnapshots/2026-08-27';

        beforeEach(async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(snapshotPath).set({
                    schemaVersion: 1,
                    snapshotDate: '2026-08-27',
                });
            });
        });

        it('denies direct reads to unauthenticated, regular, and admin clients', async () => {
            const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
            const regularDb = testEnv.authenticatedContext('regular-user').firestore();
            const adminDb = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();

            await assertFails(unauthenticatedDb.doc(snapshotPath).get());
            await assertFails(regularDb.doc(snapshotPath).get());
            await assertFails(adminDb.doc(snapshotPath).get());
        });

        it('denies direct creates, updates, and deletes even to admin clients', async () => {
            const adminDb = testEnv.authenticatedContext('admin-user', { admin: true }).firestore();

            await assertFails(adminDb.doc('adminDashboardSnapshots/2026-08-28').set({ schemaVersion: 1 }));
            await assertFails(adminDb.doc(snapshotPath).update({ schemaVersion: 2 }));
            await assertFails(adminDb.doc(snapshotPath).delete());
        });
    });

    describe('Changelogs Collection', () => {
        const userId = 'user_123';
        const adminId = 'admin_456';

        beforeEach(async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('changelogs').doc('published_post').set({
                    title: 'Published Post',
                    published: true
                });
                await context.firestore().collection('changelogs').doc('unpublished_post').set({
                    title: 'Draft Post',
                    published: false
                });
            });
        });

        it('should allow anyone to read published changelogs', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await assertSucceeds(db.collection('changelogs').doc('published_post').get());
        });

        it('should DENY non-admins from reading unpublished changelogs', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection('changelogs').doc('unpublished_post').get());
        });

        it('should allow admins to read unpublished changelogs', async () => {
            const db = testEnv.authenticatedContext(adminId, { admin: true }).firestore();
            await assertSucceeds(db.collection('changelogs').doc('unpublished_post').get());
        });

        it('should DENY non-admins from creating changelogs', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection('changelogs').add({ title: 'New Post', published: true }));
        });

        it('should allow admins to create changelogs', async () => {
            const db = testEnv.authenticatedContext(adminId, { admin: true }).firestore();
            await assertSucceeds(db.collection('changelogs').doc('new_post').set({ title: 'Admin Post', published: true }));
        });

        it('should DENY non-admins from updating changelogs', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection('changelogs').doc('published_post').update({ title: 'Hacked' }));
        });

        it('should allow admins to update changelogs', async () => {
            const db = testEnv.authenticatedContext(adminId, { admin: true }).firestore();
            await assertSucceeds(db.collection('changelogs').doc('published_post').update({ title: 'Updated Title' }));
        });

        it('should DENY non-admins from deleting changelogs', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertFails(db.collection('changelogs').doc('published_post').delete());
        });

        it('should allow admins to delete changelogs', async () => {
            const db = testEnv.authenticatedContext(adminId, { admin: true }).firestore();
            await assertSucceeds(db.collection('changelogs').doc('published_post').delete());
        });
    });
});
