import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
    FOUNDER_EMAIL_FROM,
    FOUNDER_EMAIL_REPLY_TO,
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../email/config';
import {
    EmailTemplateCatalogEntry,
    EmailTemplatePreviewCase,
    REFRESHED_EMAIL_TEMPLATE_CATALOG,
} from '../email/template-catalog';
import {
    createLocalEmailTemplateRenderer,
    LocalEmailTemplateRenderer,
    RenderedEmailMessage,
} from '../email/template-renderer';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

const MAIL_COLLECTION = 'mail';
const TEMPLATES_ROOT = resolve(__dirname, '../../templates');

export interface TestEmailArguments {
    targetEmail: string;
    inline: boolean;
}

export interface TestMailDocument {
    to: string;
    from: string;
    replyTo: string;
    template?: {
        name: string;
        data: Record<string, unknown>;
    };
    message?: RenderedEmailMessage;
}

export function parseTestEmailArguments(args: readonly string[]): TestEmailArguments {
    const unsupportedFlags = args.filter(value => value.startsWith('--') && value !== '--inline');
    const positionalArguments = args.filter(value => !value.startsWith('--'));
    if (unsupportedFlags.length > 0 || positionalArguments.length !== 1) {
        throw new Error('Usage: npm run test-emails -- target@example.com [--inline]');
    }

    return {
        targetEmail: positionalArguments[0],
        inline: args.includes('--inline'),
    };
}

export function buildTestMailDocument(
    targetEmail: string,
    template: EmailTemplateCatalogEntry,
    preview: EmailTemplatePreviewCase,
    inline: boolean,
    renderer: LocalEmailTemplateRenderer,
): TestMailDocument {
    const isFounderNote = template.id === 'registration_welcome';
    const baseDocument = {
        to: targetEmail,
        from: isFounderNote ? FOUNDER_EMAIL_FROM : TRANSACTIONAL_EMAIL_FROM,
        replyTo: isFounderNote ? FOUNDER_EMAIL_REPLY_TO : TRANSACTIONAL_EMAIL_REPLY_TO,
    };

    if (inline) {
        return {
            ...baseDocument,
            message: renderer.render(template, preview.data),
        };
    }

    return {
        ...baseDocument,
        template: {
            name: template.id,
            data: preview.data,
        },
    };
}

function initializeAdmin(): void {
    if (admin.apps.length > 0) {
        return;
    }

    const configDirectory = process.env.QS_EMAIL_TEST_CONFIG_DIR || resolve(__dirname, '../..');
    dotenv.config({ path: resolve(configDirectory, '.env') });
    // This credential remains local and is never written to a mail document or log output.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const serviceAccount = require(resolve(configDirectory, 'service-account.json'));
    const projectId = process.env.GCLOUD_PROJECT || serviceAccount.project_id;
    if (!projectId) {
        throw new Error('The email test configuration does not identify a Firebase project.');
    }
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com`,
    });
}

export async function sendTestEmails(targetEmail: string, inline = false): Promise<void> {
    if (!targetEmail) {
        throw new Error('Usage: npm run test-emails -- target@example.com [--inline]');
    }

    initializeAdmin();
    const previewCases = REFRESHED_EMAIL_TEMPLATE_CATALOG.flatMap(template =>
        template.previewCases.map(preview => ({ template, preview }))
    );
    const modeDescription = inline
        ? 'locally rendered inline smoke tests (no template seeding required)'
        : 'Firestore-template smoke tests';
    logger.info(`Queueing ${previewCases.length} ${modeDescription} for ${targetEmail}.`);

    const db = admin.firestore();
    const batch = db.batch();
    const renderer = createLocalEmailTemplateRenderer(TEMPLATES_ROOT);

    for (const { template, preview } of previewCases) {
        const docRef = db.collection(MAIL_COLLECTION).doc();
        batch.set(docRef, {
            ...buildTestMailDocument(targetEmail, template, preview, inline, renderer),
            expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
        });
        logger.info(`Queued ${template.id} (${preview.name})`);
    }

    await batch.commit();
    logger.info(`All ${modeDescription} were queued. development_update was excluded.`);
}

if (require.main === module) {
    try {
        const { targetEmail, inline } = parseTestEmailArguments(process.argv.slice(2));
        sendTestEmails(targetEmail, inline).catch(error => {
            logger.error('Failed to queue refreshed-template smoke tests.', error);
            process.exitCode = 1;
        });
    } catch (error) {
        logger.error('Invalid refreshed-template smoke-test arguments.', error);
        process.exitCode = 1;
    }
}
