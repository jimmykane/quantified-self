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

describe('Storage Security Rules', () => {
    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'test-project',
            storage: {
                rules: readFileSync(resolve(__dirname, '../storage.quantified-self-io.rules'), 'utf8'),
                host: 'localhost',
                port: 9199,
            },
            firestore: {
                rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
                host: 'localhost',
                port: 8081,
            }
        });
    });

    afterAll(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await Promise.all([
            testEnv.clearFirestore(),
            // @ts-ignore - clearStorage exists in rules-unit-testing but might not be in types depending on version
            testEnv.clearStorage ? testEnv.clearStorage() : Promise.resolve(),
        ]);
    });

    const userId = 'user_123';
    const eventId = 'event_123';
    const filePath = `users/${userId}/events/${eventId}/original.fit`;

    it('should allow owner to read their own file', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const bucket = context.storage();
            await bucket.ref(filePath).put(new TextEncoder().encode('test'));
        });
        const bucket = testEnv.authenticatedContext(userId).storage();
        await assertSucceeds(bucket.ref(filePath).getMetadata());
    });

    it('should allow anyone to read a public event file', async () => {
        // Setup Storage file with public privacy metadata
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const bucket = context.storage();
            await bucket.ref(filePath).put(new TextEncoder().encode('test'), {
                customMetadata: { privacy: 'public' }
            });
        });

        const unauthBucket = testEnv.unauthenticatedContext().storage();
        await assertSucceeds(unauthBucket.ref(filePath).getMetadata());
    });

    it('should deny unauthenticated users from reading a private event file', async () => {
        // Setup Storage file with private privacy metadata
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const bucket = context.storage();
            await bucket.ref(filePath).put(new TextEncoder().encode('test'), {
                customMetadata: { privacy: 'private' }
            });
        });

        const unauthBucket = testEnv.unauthenticatedContext().storage();
        await assertFails(unauthBucket.ref(filePath).getMetadata());
    });

    it('should deny unauthenticated users from reading a non-existing event file (privacy check fails)', async () => {
        const unauthBucket = testEnv.unauthenticatedContext().storage();
        await assertFails(unauthBucket.ref(filePath).getMetadata());
    });
});
