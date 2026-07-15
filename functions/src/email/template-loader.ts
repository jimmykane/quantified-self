import * as fs from 'fs';
import * as path from 'path';
import {
    EMAIL_PARTIAL_CATALOG,
    selectRefreshedTemplates,
} from './template-catalog';

export interface EmailTemplateSeedDocument {
    id: string;
    data: {
        partial?: true;
        subject?: string;
        html: string;
        text: string;
    };
}

function readTemplateFile(templateRoot: string, relativePath: string): string {
    return fs.readFileSync(path.join(templateRoot, relativePath), 'utf8');
}

export function loadEmailTemplateSeedDocuments(
    templateRoot: string,
    requestedTemplateIds?: readonly string[],
): readonly EmailTemplateSeedDocument[] {
    const templates = selectRefreshedTemplates(requestedTemplateIds);
    const requiredPartialIds = new Set(templates.flatMap(template => template.partials));

    const partialDocuments = EMAIL_PARTIAL_CATALOG
        .filter(partial => requiredPartialIds.has(partial.id))
        .map(partial => ({
            id: partial.id,
            data: {
                partial: true as const,
                html: readTemplateFile(templateRoot, partial.htmlFile),
                text: readTemplateFile(templateRoot, partial.textFile),
            },
        }));

    const templateDocuments = templates.map(template => ({
        id: template.id,
        data: {
            subject: template.subject,
            html: readTemplateFile(templateRoot, template.htmlFile),
            text: readTemplateFile(templateRoot, template.textFile),
        },
    }));

    return [...partialDocuments, ...templateDocuments];
}
