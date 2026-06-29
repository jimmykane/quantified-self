import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type StorageRulesTestEnvironment = RulesTestEnvironment & {
    clearStorage?: () => Promise<void>;
};

let testEnv: StorageRulesTestEnvironment;

describe('Storage Security Rules', () => {
    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'demo-test',
            firestore: {
                rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
                host: 'localhost',
                port: 8081,
            },
            storage: {
                rules: readFileSync(resolve(__dirname, '../storage.quantified-self-io.rules'), 'utf8'),
                host: 'localhost',
                port: 9199,
            },
        }) as StorageRulesTestEnvironment;
    });

    afterAll(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.clearStorage?.();
    });

    const userId = 'user_123';
    const otherUserId = 'other_123';
    const eventId = 'event_123';
    const filePath = `users/${userId}/events/${eventId}/original.fit`;
    const otherFilePath = `users/${userId}/imports/original.fit`;
    const testBucketUrl = 'gs://demo-test.appspot.com';
    const testBucketName = 'demo-test.appspot.com';
    const storageEmulatorOrigin = 'http://127.0.0.1:9199';

    function storageForUser(userID?: string) {
        return userID
            ? testEnv.authenticatedContext(userID).storage(testBucketUrl)
            : testEnv.unauthenticatedContext().storage(testBucketUrl);
    }

    async function seedFile(path: string, privacy: 'public' | 'private' | null = null): Promise<void> {
        const boundary = `storage-rules-test-${Date.now()}`;
        const metadata = privacy ? { name: path, metadata: { privacy } } : { name: path };
        const body = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            JSON.stringify(metadata),
            `--${boundary}`,
            'Content-Type: text/plain',
            '',
            'test',
            `--${boundary}--`,
            '',
        ].join('\r\n');
        const response = await fetch(`${storageEmulatorOrigin}/upload/storage/v1/b/${testBucketName}/o?uploadType=multipart&name=${encodeURIComponent(path)}`, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
        });

        if (!response.ok) {
            throw new Error(`Could not seed storage file: ${response.status} ${await response.text()}`);
        }
    }

    async function seedEventPrivacy(privacy: 'public' | 'private'): Promise<void> {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await context.firestore().doc(`users/${userId}/events/${eventId}`).set({ privacy });
        });
    }

    it('allows owners to read their own private event source files', async () => {
        await seedFile(filePath, 'private');

        await assertSucceeds(storageForUser(userId).ref(filePath).getMetadata());
    });

    it('allows anonymous reads for event source files with public metadata', async () => {
        await seedEventPrivacy('public');
        await seedFile(filePath, 'public');

        await assertSucceeds(storageForUser().ref(filePath).getMetadata());
    });

    it('denies anonymous reads for public metadata when the parent event is private', async () => {
        await seedEventPrivacy('private');
        await seedFile(filePath, 'public');

        await assertFails(storageForUser().ref(filePath).getMetadata());
    });

    it('denies anonymous reads for public metadata when the parent event is missing', async () => {
        await seedFile(filePath, 'public');

        await assertFails(storageForUser().ref(filePath).getMetadata());
    });

    it('denies anonymous and other-user reads for private event source files', async () => {
        await seedFile(filePath, 'private');

        await assertFails(storageForUser().ref(filePath).getMetadata());
        await assertFails(storageForUser(otherUserId).ref(filePath).getMetadata());
    });

    it('does not allow public metadata outside the event source-file path', async () => {
        await seedFile(otherFilePath, 'public');

        await assertFails(storageForUser().ref(otherFilePath).getMetadata());
        await assertSucceeds(storageForUser(userId).ref(otherFilePath).getMetadata());
    });

    it('keeps client writes backend-only', async () => {
        const response = await fetch(`${storageEmulatorOrigin}/v0/b/${testBucketName}/o?name=${encodeURIComponent(filePath)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
            },
            body: 'test',
        });

        expect(response.status).toBe(403);
    });
});
