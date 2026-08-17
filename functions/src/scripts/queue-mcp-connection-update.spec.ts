import { describe, expect, it } from 'vitest';
import {
    buildCampaignMailDocument,
    deduplicateActivePaidSubscriptions,
    parseQueueOptions,
} from './queue-mcp-connection-update';

describe('queue-mcp-connection-update', () => {
    it('defaults to dry-run and requires an explicit production count before writes', () => {
        expect(parseQueueOptions(['--project=quantified-self-io'])).toEqual({
            projectId: 'quantified-self-io',
            dryRun: true,
            concurrency: 10,
        });
        expect(() => parseQueueOptions([
            '--project=quantified-self-io',
            '--dry-run=false',
        ])).toThrow(/expected-recipients/);
        expect(() => parseQueueOptions([
            '--project=another-project',
            '--dry-run=false',
            '--expected-recipients=1',
        ])).toThrow(/outside quantified-self-io/);
        expect(() => parseQueueOptions([
            '--project=quantified-self-io',
            '--concurrency=21',
        ])).toThrow(/Usage/);
    });

    it('deduplicates active subscriptions by UID and keeps the highest paid role', () => {
        expect([...deduplicateActivePaidSubscriptions([
            { uid: 'basic-user', role: 'basic' },
            { uid: 'upgraded-user', role: 'basic' },
            { uid: 'upgraded-user', role: 'pro' },
            { uid: 'pro-user', role: 'pro' },
        ])]).toEqual([
            ['basic-user', 'basic'],
            ['upgraded-user', 'pro'],
            ['pro-user', 'pro'],
        ]);
    });

    it('builds a deletion-cleanup-compatible inline mail document', () => {
        const document = buildCampaignMailDocument({
            uid: 'user-1',
            role: 'pro',
            email: 'member@example.com',
            firstName: 'Ada',
        });

        expect(document.to).toBe('member@example.com');
        expect(document.toUids).toEqual(['user-1']);
        expect(document.message.subject).toBe('Reconnect your Quantified Self ChatGPT app');
        expect(document.message.html).toContain('Hi Ada');
        expect(document.message.text).toContain('select Manage');
        expect(document.message.html).not.toMatch(/{{[^}]+}}/);
    });
});
