import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import * as path from 'path';
import { loadEmailTemplateSeedDocuments } from '../email/template-loader';

const TEMPLATES_COLLECTION = 'email_templates';
const TEMPLATES_DIR = path.join(__dirname, '../../templates');

function parseTemplateFilter(args: readonly string[]): readonly string[] | undefined {
    const inline = args.find(arg => arg.startsWith('--templates='));
    const templatesFlagIndex = args.indexOf('--templates');
    const raw = inline?.slice('--templates='.length)
        || (templatesFlagIndex >= 0 ? args[templatesFlagIndex + 1] : undefined);

    if (!raw) {
        return undefined;
    }

    return raw.split(',').map(value => value.trim()).filter(Boolean);
}

export async function seedTemplates(requestedTemplateIds?: readonly string[]): Promise<void> {
    if (admin.apps.length === 0) {
        admin.initializeApp();
    }

    const documents = loadEmailTemplateSeedDocuments(TEMPLATES_DIR, requestedTemplateIds);
    logger.info(`Seeding ${documents.length} allowlisted email template documents to '${TEMPLATES_COLLECTION}'.`);

    for (const document of documents) {
        await admin.firestore().collection(TEMPLATES_COLLECTION).doc(document.id).set(document.data);
        logger.info(`Seeded ${document.id}`);
    }

    logger.info('Email template seeding complete. development_update was not eligible for selection.');
}

if (require.main === module) {
    const requestedTemplateIds = parseTemplateFilter(process.argv.slice(2));
    seedTemplates(requestedTemplateIds).catch(error => {
        logger.error('Email template seeding failed.', error);
        process.exitCode = 1;
    });
}
