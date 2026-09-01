import * as path from 'path';
import {
    FOUNDER_EMAIL_FROM,
    FOUNDER_EMAIL_REPLY_TO,
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../email/config';
import {
    MCP_CONNECTION_UPDATE_TEMPLATE_ID,
    REFRESHED_EMAIL_TEMPLATE_CATALOG,
} from '../email/template-catalog';
import { createLocalEmailTemplateRenderer } from '../email/template-renderer';
import {
    buildEmailTestAdminOptions,
    buildTestMailDocument,
    parseTestEmailArguments,
} from './test-all-emails';

const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates');
const TARGET_EMAIL = 'controlled-inbox@example.com';

describe('test-all-emails', () => {
    const renderer = createLocalEmailTemplateRenderer(TEMPLATE_ROOT);

    it('requires one recipient and an explicit project while allowing an exact manual-template selection', () => {
        expect(parseTestEmailArguments([TARGET_EMAIL, '--project=quantified-self-test'])).toEqual({
            targetEmail: TARGET_EMAIL,
            projectId: 'quantified-self-test',
            inline: false,
        });
        expect(parseTestEmailArguments([
            '--inline',
            '--project=quantified-self-test',
            TARGET_EMAIL,
        ])).toEqual({
            targetEmail: TARGET_EMAIL,
            projectId: 'quantified-self-test',
            inline: true,
        });
        expect(parseTestEmailArguments([
            TARGET_EMAIL,
            '--project=quantified-self-test',
            `--templates=${MCP_CONNECTION_UPDATE_TEMPLATE_ID}`,
        ])).toEqual({
            targetEmail: TARGET_EMAIL,
            projectId: 'quantified-self-test',
            inline: false,
            templateIds: [MCP_CONNECTION_UPDATE_TEMPLATE_ID],
        });
        expect(() => parseTestEmailArguments([])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([TARGET_EMAIL])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([
            TARGET_EMAIL,
            '--project=quantified-self-test',
            '--unknown',
        ])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([
            TARGET_EMAIL,
            'second@example.com',
            '--project=quantified-self-test',
        ])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([TARGET_EMAIL, '--project='])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([
            TARGET_EMAIL,
            '--project=first-project',
            '--project=second-project',
        ])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([
            TARGET_EMAIL,
            '--project=quantified-self-test',
            '--templates=',
        ])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([
            TARGET_EMAIL,
            '--project=quantified-self-test',
            `--templates=${MCP_CONNECTION_UPDATE_TEMPLATE_ID},${MCP_CONNECTION_UPDATE_TEMPLATE_ID}`,
        ])).toThrow(/Usage/);
    });

    it('builds keyless Admin options for the explicitly selected project', () => {
        const options = buildEmailTestAdminOptions('quantified-self-test');

        expect(options).toEqual({
            projectId: 'quantified-self-test',
            databaseURL: 'https://quantified-self-test.firebaseio.com',
        });
        expect(options).not.toHaveProperty('credential');
    });

    it('keeps the original Firestore-template queue format by default', () => {
        const template = REFRESHED_EMAIL_TEMPLATE_CATALOG.find(entry => entry.id === 'welcome_email')!;
        const preview = template.previewCases.find(entry => entry.name === 'free')!;
        const document = buildTestMailDocument(TARGET_EMAIL, template, preview, false, renderer);

        expect(document).toEqual({
            to: TARGET_EMAIL,
            from: TRANSACTIONAL_EMAIL_FROM,
            replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
            template: {
                name: template.id,
                data: preview.data,
            },
        });
        expect(document.message).toBeUndefined();
    });

    it('renders every catalog preview inline without requiring seeded templates', () => {
        const documents = REFRESHED_EMAIL_TEMPLATE_CATALOG.flatMap(template =>
            template.previewCases.map(preview => ({
                template,
                document: buildTestMailDocument(TARGET_EMAIL, template, preview, true, renderer),
            }))
        );

        expect(documents).toHaveLength(14);
        for (const { template, document } of documents) {
            expect(document.template).toBeUndefined();
            expect(document.message?.subject).toBeTruthy();
            expect(document.message?.html).toContain('<!doctype html>');
            expect(document.message?.html).toContain('</html>');
            expect(document.message?.text).toBeTruthy();
            expect(document.message?.subject).not.toMatch(/{{[^}]+}}/);
            expect(document.message?.html).not.toMatch(/{{[^}]+}}/);
            expect(document.message?.text).not.toMatch(/{{[^}]+}}/);

            const isFounderNote = template.id === 'registration_welcome';
            expect(document.from).toBe(isFounderNote ? FOUNDER_EMAIL_FROM : TRANSACTIONAL_EMAIL_FROM);
            expect(document.replyTo).toBe(isFounderNote ? FOUNDER_EMAIL_REPLY_TO : TRANSACTIONAL_EMAIL_REPLY_TO);
        }
    });
});
