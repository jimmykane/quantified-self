import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import {
    EMAIL_PARTIAL_CATALOG,
    EmailTemplateCatalogEntry,
} from './template-catalog';

export interface RenderedEmailMessage {
    subject: string;
    html: string;
    text: string;
}

export interface LocalEmailTemplateRenderer {
    render(template: EmailTemplateCatalogEntry, data: Record<string, unknown>): RenderedEmailMessage;
}

function readTemplateFile(templateRoot: string, relativePath: string): string {
    return fs.readFileSync(path.join(templateRoot, relativePath), 'utf8');
}

export function createLocalEmailTemplateRenderer(templateRoot: string): LocalEmailTemplateRenderer {
    const subjectEnvironment = Handlebars.create();
    const htmlEnvironment = Handlebars.create();
    const textEnvironment = Handlebars.create();

    for (const partial of EMAIL_PARTIAL_CATALOG) {
        htmlEnvironment.registerPartial(partial.id, readTemplateFile(templateRoot, partial.htmlFile));
        textEnvironment.registerPartial(partial.id, readTemplateFile(templateRoot, partial.textFile));
    }

    return {
        render(template, data): RenderedEmailMessage {
            return {
                subject: subjectEnvironment.compile(template.subject, { strict: true })(data),
                html: htmlEnvironment.compile(
                    readTemplateFile(templateRoot, template.htmlFile),
                    { strict: true },
                )(data),
                text: textEnvironment.compile(
                    readTemplateFile(templateRoot, template.textFile),
                    { strict: true },
                )(data),
            };
        },
    };
}
