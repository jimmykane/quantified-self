import * as path from 'path';
import {
    FOUNDER_EMAIL_FROM,
    FOUNDER_EMAIL_REPLY_TO,
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../email/config';
import { REFRESHED_EMAIL_TEMPLATE_CATALOG } from '../email/template-catalog';
import { createLocalEmailTemplateRenderer } from '../email/template-renderer';
import {
    buildTestMailDocument,
    parseTestEmailArguments,
} from './test-all-emails';

const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates');
const TARGET_EMAIL = 'controlled-inbox@example.com';

describe('test-all-emails', () => {
    const renderer = createLocalEmailTemplateRenderer(TEMPLATE_ROOT);

    it('requires one recipient and accepts only the explicit inline flag', () => {
        expect(parseTestEmailArguments([TARGET_EMAIL])).toEqual({
            targetEmail: TARGET_EMAIL,
            inline: false,
        });
        expect(parseTestEmailArguments([TARGET_EMAIL, '--inline'])).toEqual({
            targetEmail: TARGET_EMAIL,
            inline: true,
        });
        expect(() => parseTestEmailArguments([])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([TARGET_EMAIL, '--unknown'])).toThrow(/Usage/);
        expect(() => parseTestEmailArguments([TARGET_EMAIL, 'second@example.com'])).toThrow(/Usage/);
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

        expect(documents).toHaveLength(13);
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
