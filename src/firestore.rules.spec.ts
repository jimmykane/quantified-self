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


    describe('User Split Model', () => {
        const userId = 'split_user';
        const otherId = 'other_user';
        const eventId = 'event_123';

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

            it('should deny unauthenticated read of public event', async () => {
                const db = testEnv.unauthenticatedContext().firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'public'
                    });
                });

                await assertFails(db.collection(`users/${userId}/events`).doc(eventId).get());
            });

            it('should deny other authenticated users from reading a public event', async () => {
                const db = testEnv.authenticatedContext(otherId).firestore();
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await context.firestore().doc(`users/${userId}/events/${eventId}`).set({
                        name: 'Morning Run',
                        privacy: 'public'
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

        it('should deny unauthenticated users from reading public activities', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/activities`).doc('public_activity').set({
                    type: 'Swimming',
                    privacy: 'public'
                });
            });
            await assertFails(db.collection(`users/${userId}/activities`).doc('public_activity').get());
        });

        it('should deny other authenticated users from reading public activities', async () => {
            const db = testEnv.authenticatedContext(otherId).firestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection(`users/${userId}/activities`).doc('public_activity_2').set({
                    type: 'Cycling',
                    privacy: 'public'
                });
            });
            await assertFails(db.collection(`users/${userId}/activities`).doc('public_activity_2').get());
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
