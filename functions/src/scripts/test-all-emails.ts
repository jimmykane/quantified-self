import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
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
    selectSeedableTemplates,
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
    projectId: string;
    inline: boolean;
    templateIds?: string[];
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
    const projectArguments = args.filter(value => value.startsWith('--project='));
    const templateArguments = args.filter(value => value.startsWith('--templates='));
    const unsupportedFlags = args.filter(value =>
        value.startsWith('--')
        && value !== '--inline'
        && !value.startsWith('--project=')
        && !value.startsWith('--templates=')
    );
    const positionalArguments = args.filter(value => !value.startsWith('--'));
    const projectId = projectArguments[0]?.slice('--project='.length).trim();
    const templateIds = templateArguments[0]?.slice('--templates='.length)
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    if (
        unsupportedFlags.length > 0
        || positionalArguments.length !== 1
        || projectArguments.length !== 1
        || templateArguments.length > 1
        || !projectId
        || (templateArguments.length === 1 && (!templateIds || templateIds.length === 0))
        || (templateIds && new Set(templateIds).size !== templateIds.length)
    ) {
        throw new Error(
            'Usage: npm run test-emails -- target@example.com --project=PROJECT_ID [--inline] [--templates=template_id,...]'
        );
    }

    return {
        targetEmail: positionalArguments[0],
        projectId,
        inline: args.includes('--inline'),
        ...(templateIds ? { templateIds } : {}),
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

export function buildEmailTestAdminOptions(projectId: string): admin.AppOptions {
    return {
        projectId,
        databaseURL: `https://${projectId}.firebaseio.com`,
    };
}

function initializeAdmin(projectId: string): void {
    if (admin.apps.length > 0) {
        return;
    }

    admin.initializeApp(buildEmailTestAdminOptions(projectId));
}

export async function sendTestEmails(
    targetEmail: string,
    projectId: string,
    inline = false,
    templateIds?: readonly string[],
): Promise<void> {
    if (!targetEmail || !projectId) {
        throw new Error(
            'Usage: npm run test-emails -- target@example.com --project=PROJECT_ID [--inline] [--templates=template_id,...]'
        );
    }

    initializeAdmin(projectId);
    const templates = selectSeedableTemplates(templateIds);
    const previewCases = templates.flatMap(template =>
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
        const { targetEmail, projectId, inline, templateIds } = parseTestEmailArguments(process.argv.slice(2));
        sendTestEmails(targetEmail, projectId, inline, templateIds).catch(error => {
            logger.error('Failed to queue selected-template smoke tests.', error);
            process.exitCode = 1;
        });
    } catch (error) {
        logger.error('Invalid refreshed-template smoke-test arguments.', error);
        process.exitCode = 1;
    }
}
