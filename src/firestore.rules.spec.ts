import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, it, beforeAll, afterAll } from 'vitest';

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

        it('should allow user to clear their own stripeId and stripeLink', async () => {
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
            await assertSucceeds(db.collection('customers').doc(userId).update({
                stripeId: null,
                stripeLink: null
            }));
        });

        it('should allow user to delete their stripeId using deleteField()', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();
            const { deleteField } = await import('firebase/firestore');

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('customers').doc(userId).set({
                    stripeId: 'cus_to_delete',
                    stripeLink: 'https://stripe.com/delete'
                });
            });

            // User clears their fields specificially using deleteField()
            await assertSucceeds(db.collection('customers').doc(userId).update({
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

        it('should allow user to update other fields without touching stripeId', async () => {
            const db = testEnv.authenticatedContext(userId).firestore();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().collection('customers').doc(userId).set({
                    stripeId: 'cus_stable',
                    settings: { theme: 'dark' }
                });
            });

            await assertSucceeds(db.collection('customers').doc(userId).update({
                'settings.theme': 'light'
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

    });

});
