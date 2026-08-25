import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('unified health account lifecycle', () => {
    it('keeps all health collections beneath the recursively deleted user root', () => {
        const extensionEnvironment = readFileSync(
            resolve(__dirname, '../../../extensions/delete-user-data.env'),
            'utf8',
        );

        expect(extensionEnvironment).toMatch(/^FIRESTORE_DELETE_MODE=recursive$/m);
        expect(extensionEnvironment).toMatch(/^FIRESTORE_PATHS=users\/\{UID\},customers\/\{UID\}$/m);
        expect(extensionEnvironment).not.toContain('healthSourceRecords');
        expect(extensionEnvironment).not.toContain('healthSampleChunks');
        expect(extensionEnvironment).not.toContain('healthSyncState');
    });
});
