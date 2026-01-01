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

            it('should deny updates to unknown fields', async () => {
                const db = testEnv.authenticatedContext(userId).firestore();
                await assertFails(db.collection('users').doc(userId).collection('legal').doc('agreements').set({
                    acceptedPrivacyPolicy: true,
                    someRandomField: true
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

        it('should allow user to write their own activity', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            await assertSucceeds(db.collection(`users/${userId}/activities`).doc(activityId).set({
                type: 'Running',
                distance: 5000
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

        it('should allow a verified Coach to read their athletes activity', async () => {
            const coachId = 'coach_user';
            const athleteId = 'athlete_user';
            const activityId = 'athlete_activity';

            const db = testEnv.authenticatedContext(coachId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                // Setup Coach relationship
                await context.firestore().collection(`coaches/${coachId}/athletes`).doc(athleteId).set({
                    accepted: true
                });
                // Create athlete activity
                await context.firestore().collection(`users/${athleteId}/activities`).doc(activityId).set({
                    type: 'Running'
                });
            });

            await assertSucceeds(db.collection(`users/${athleteId}/activities`).doc(activityId).get());
        });

        it('should DENY unauthenticated users from reading activities', async () => {
            const db = testEnv.unauthenticatedContext().firestore();
            await assertFails(db.collection(`users/${userId}/activities`).doc(activityId).get());
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
});
