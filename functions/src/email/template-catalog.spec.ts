import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { describe, expect, it } from 'vitest';
import {
    DEVELOPMENT_UPDATE_TEMPLATE_ID,
    EMAIL_PARTIAL_CATALOG,
    REFRESHED_EMAIL_TEMPLATE_CATALOG,
    selectRefreshedTemplates,
} from './template-catalog';
import { loadEmailTemplateSeedDocuments } from './template-loader';

const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates');
const DEVELOPMENT_UPDATE_SHA256 = 'ed314b23f798fe710a0c88b83346689948365478cd5c993c63494f2c1cc77f26';

function readTemplate(relativePath: string): string {
    return fs.readFileSync(path.join(TEMPLATE_ROOT, relativePath), 'utf8');
}

function createHandlebarsEnvironment(kind: 'html' | 'text'): typeof Handlebars {
    const environment = Handlebars.create();
    for (const partial of EMAIL_PARTIAL_CATALOG) {
        environment.registerPartial(partial.id, readTemplate(kind === 'html' ? partial.htmlFile : partial.textFile));
    }
    return environment;
}

function expectNoUnresolvedHandlebars(rendered: string): void {
    expect(rendered).not.toMatch(/{{[^}]+}}/);
}

function expectValidRenderedUrls(html: string): void {
    const urls = Array.from(html.matchAll(/(?:href|src)="([^"]+)"/g), match => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const value of urls) {
        const parsed = new URL(value);
        expect(['https:', 'mailto:']).toContain(parsed.protocol);
    }
}

describe('refreshed email template catalog', () => {
    it('contains the approved template IDs and exact subjects', () => {
        expect(Object.fromEntries(REFRESHED_EMAIL_TEMPLATE_CATALOG.map(template => [template.id, template.subject]))).toEqual({
            registration_welcome: 'Welcome to Quantified Self — a note from Dimitrios',
            welcome_email: 'Your {{role}} membership is active',
            subscription_upgrade: 'You’re now on {{new_role}}',
            subscription_downgrade: 'Your membership is now {{new_role}}',
            subscription_cancellation: 'Your {{role}} membership will end on {{expiration_date}}',
            subscription_expiring_soon: 'Reminder: your {{role}} membership ends on {{expiration_date}}',
            account_deleted_confirmation: 'Your Quantified Self account has been deleted',
        });
    });

    it('compiles every subject, HTML body, plaintext body, and partial for every preview case', () => {
        const htmlEnvironment = createHandlebarsEnvironment('html');
        const textEnvironment = createHandlebarsEnvironment('text');

        for (const partial of EMAIL_PARTIAL_CATALOG) {
            expect(() => htmlEnvironment.compile(readTemplate(partial.htmlFile), { strict: true })({})).not.toThrow();
            expect(() => textEnvironment.compile(readTemplate(partial.textFile), { strict: true })({})).not.toThrow();
        }

        for (const template of REFRESHED_EMAIL_TEMPLATE_CATALOG) {
            const htmlSource = readTemplate(template.htmlFile);
            const textSource = readTemplate(template.textFile);
            expect(htmlSource).not.toContain('{{{');
            expect(textSource).not.toContain('{{{');

            for (const preview of template.previewCases) {
                const subject = Handlebars.compile(template.subject, { strict: true })(preview.data);
                const html = htmlEnvironment.compile(htmlSource, { strict: true })(preview.data);
                const text = textEnvironment.compile(textSource, { strict: true })(preview.data);

                expectNoUnresolvedHandlebars(subject);
                expectNoUnresolvedHandlebars(html);
                expectNoUnresolvedHandlebars(text);
                expect(html).toContain('<!doctype html>');
                expect(html).toContain('</html>');
                expect(text).not.toMatch(/<[^>]+>/);
                expectValidRenderedUrls(html);
            }
        }
    });

    it('renders trial, paid, conditional device-sync, and unknown-role variants correctly', () => {
        const htmlEnvironment = createHandlebarsEnvironment('html');
        const render = (templateId: string, previewName: string): string => {
            const template = REFRESHED_EMAIL_TEMPLATE_CATALOG.find(entry => entry.id === templateId)!;
            const preview = template.previewCases.find(entry => entry.name === previewName)!;
            return htmlEnvironment.compile(readTemplate(template.htmlFile), { strict: true })(preview.data);
        };

        expect(render('welcome_email', 'basic-trial')).toContain('trial has started');
        expect(render('welcome_email', 'pro-paid')).toContain('independent, privacy-first development');
        expect(render('subscription_downgrade', 'pro-to-basic')).toContain('Device sync is not included');
        expect(render('subscription_downgrade', 'basic-to-free')).not.toContain('Device sync is not included');
        expect(render('subscription_downgrade', 'unknown-role')).not.toContain('Up to');
    });

    it('uses fluid shells that do not depend on media-query support at narrow widths', () => {
        expect(readTemplate('partials/email_transactional_header.hbs')).toContain('class="email-shell" width="100%"');
        expect(readTemplate('partials/email_founder_header.hbs')).toContain('class="letter" width="100%"');
    });

    it('allowlists refreshed templates and always excludes development_update from seeding', () => {
        expect(selectRefreshedTemplates().some(template => template.id === DEVELOPMENT_UPDATE_TEMPLATE_ID)).toBe(false);
        expect(() => selectRefreshedTemplates([DEVELOPMENT_UPDATE_TEMPLATE_ID])).toThrow(/intentionally excluded/);

        const documents = loadEmailTemplateSeedDocuments(TEMPLATE_ROOT);
        expect(documents.some(document => document.id === DEVELOPMENT_UPDATE_TEMPLATE_ID)).toBe(false);
        expect(documents.filter(document => document.data.partial)).toHaveLength(EMAIL_PARTIAL_CATALOG.length);
        expect(documents.filter(document => !document.data.partial)).toHaveLength(REFRESHED_EMAIL_TEMPLATE_CATALOG.length);
        expect(documents.every(document => document.data.html.length > 0 && document.data.text.length > 0)).toBe(true);
    });

    it('loads only an explicitly requested refreshed template and its required partials', () => {
        const documents = loadEmailTemplateSeedDocuments(TEMPLATE_ROOT, ['registration_welcome']);

        expect(documents.map(document => document.id)).toEqual([
            'email_founder_header',
            'email_founder_footer',
            'registration_welcome',
        ]);
    });

    it('keeps development_update byte-for-byte unchanged', () => {
        const developmentUpdate = readTemplate('development_update.hbs');
        const digest = createHash('sha256').update(developmentUpdate).digest('hex');

        expect(digest).toBe(DEVELOPMENT_UPDATE_SHA256);
    });
});
