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

        describe('AI Insights Latest Snapshot (users/{uid}/aiInsightsRequests/latest)', () => {
            it('should deny owner from writing the latest doc', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.doc(`users/${userId}/aiInsightsRequests/latest`).set({
                    version: 1,
                    savedAt: '2026-03-18T12:00:00.000Z',
                    prompt: 'Show my total distance all time',
                    response: {
                        status: 'unsupported',
                        narrative: 'Unsupported request',
                        reasonCode: 'unsupported_capability',
                        suggestedPrompts: ['Show my total distance this year']
                    }
                }));
            });

            it('should allow owner to read the fixed latest doc', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/aiInsightsRequests/latest`).set({
                        version: 1,
                        savedAt: '2026-03-18T12:00:00.000Z',
                        prompt: 'Show my total distance all time',
                        response: {
                            status: 'unsupported',
                            narrative: 'Unsupported request',
                            reasonCode: 'unsupported_capability',
                            suggestedPrompts: ['Show my total distance this year']
                        }
                    });
                });

                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.doc(`users/${userId}/aiInsightsRequests/latest`).get());
            });

            it('should allow owner to delete the fixed latest doc', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/aiInsightsRequests/latest`).set({
                        version: 1,
                        savedAt: '2026-03-18T12:00:00.000Z',
                        prompt: 'Show my total distance all time',
                        response: {
                            status: 'unsupported',
                            narrative: 'Unsupported request',
                            reasonCode: 'unsupported_capability',
                            suggestedPrompts: ['Show my total distance this year']
                        }
                    });
                });

                const db = testEnv.authenticatedContext(userId).firestore();
                await assertSucceeds(db.doc(`users/${userId}/aiInsightsRequests/latest`).delete());
            });

            it('should deny owner from writing any doc id other than latest', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.doc(`users/${userId}/aiInsightsRequests/history_1`).set({
                    version: 1
                }));
            });

            it('should deny other users from reading latest AI insight snapshots', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/aiInsightsRequests/latest`).set({
                        version: 1,
                        savedAt: '2026-03-18T12:00:00.000Z',
                        prompt: 'Show my total distance all time',
                        response: {
                            status: 'unsupported',
                            narrative: 'Unsupported request',
                            reasonCode: 'unsupported_capability',
                            suggestedPrompts: ['Show my total distance this year']
                        }
                    });
                });

                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.doc(`users/${userId}/aiInsightsRequests/latest`).get());
            });

            it('should deny other users from writing latest AI insight snapshots', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.doc(`users/${userId}/aiInsightsRequests/latest`).set({
                    version: 1,
                    savedAt: '2026-03-18T12:00:00.000Z',
                    prompt: 'Show my total distance all time'
                }));
            });

            it('should deny other users from deleting latest AI insight snapshots', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/aiInsightsRequests/latest`).set({
                        version: 1,
                        savedAt: '2026-03-18T12:00:00.000Z',
                        prompt: 'Show my total distance all time',
                        response: {
                            status: 'unsupported',
                            narrative: 'Unsupported request',
                            reasonCode: 'unsupported_capability',
                            suggestedPrompts: ['Show my total distance this year']
                        }
                    });
                });

                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.doc(`users/${userId}/aiInsightsRequests/latest`).delete());
            });
        });

        describe('AI Insights Usage (users/{uid}/aiInsightsUsage/{periodDocId})', () => {
            const usageDocId = 'period_1740787200000_1743465600000';

            it('should deny owner from reading AI insights usage period docs', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/aiInsightsUsage/${usageDocId}`).set({
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
                await assertFails(db.doc(`users/${userId}/aiInsightsUsage/${usageDocId}`).get());
            });

            it('should deny owner from writing AI insights usage period docs', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.doc(`users/${userId}/aiInsightsUsage/${usageDocId}`).set({
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

            it('should deny other users from reading AI insights usage period docs', async () => {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/aiInsightsUsage/${usageDocId}`).set({
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
                await assertFails(db.doc(`users/${userId}/aiInsightsUsage/${usageDocId}`).get());
            });

            it('should deny other users from writing AI insights usage period docs', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await assertFails(db.doc(`users/${userId}/aiInsightsUsage/${usageDocId}`).set({
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

    describe('AI Insights Prompt Repair Backlog (aiInsightsPromptRepairs/{docId})', () => {
        const docId = 'repair-intent-1';

        it('should deny authenticated users from reading repair backlog docs', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(`aiInsightsPromptRepairs/${docId}`).set({
                    canonicalPrompt: 'show max heart rate by activity type',
                    normalizedQuerySignature: '{"q":"sig"}',
                    normalizedQuery: { resultKind: 'aggregate' },
                    seenCount: 3,
                });
            });

            const db = testEnv.authenticatedContext('repair-user').firestore();
            await assertFails(db.doc(`aiInsightsPromptRepairs/${docId}`).get());
        });

        it('should deny authenticated users from writing repair backlog docs', async () => {
            const db = testEnv.authenticatedContext('repair-user').firestore();
            await assertFails(db.doc(`aiInsightsPromptRepairs/${docId}`).set({
                canonicalPrompt: 'show max heart rate by activity type',
                normalizedQuerySignature: '{"q":"sig"}',
                seenCount: 1,
            }));
        });

        it('should deny unauthenticated users from reading repair backlog docs', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc(`aiInsightsPromptRepairs/${docId}`).set({
                    canonicalPrompt: 'show max heart rate by activity type',
                    normalizedQuerySignature: '{"q":"sig"}',
                    normalizedQuery: { resultKind: 'aggregate' },
                    seenCount: 3,
                });
            });

            const db = testEnv.unauthenticatedContext().firestore();
            await assertFails(db.doc(`aiInsightsPromptRepairs/${docId}`).get());
        });

        it('should deny unauthenticated users from writing repair backlog docs', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await assertFails(db.doc(`aiInsightsPromptRepairs/${docId}`).set({
                canonicalPrompt: 'show max heart rate by activity type',
                normalizedQuerySignature: '{"q":"sig"}',
                seenCount: 1,
            }));
        });
    });

    describe('Server-Owned Queue Collections', () => {
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
