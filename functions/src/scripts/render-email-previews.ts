import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import {
    EMAIL_PARTIAL_CATALOG,
    REFRESHED_EMAIL_TEMPLATE_CATALOG,
} from '../email/template-catalog';

const templateRoot = path.resolve(__dirname, '../../templates');
const outputRoot = path.resolve(process.argv[2] || '/tmp/quantified-self-email-previews');
const handlebars = Handlebars.create();

for (const partial of EMAIL_PARTIAL_CATALOG) {
    const source = fs.readFileSync(path.join(templateRoot, partial.htmlFile), 'utf8');
    handlebars.registerPartial(partial.id, source);
}

fs.mkdirSync(outputRoot, { recursive: true });

for (const template of REFRESHED_EMAIL_TEMPLATE_CATALOG) {
    const source = fs.readFileSync(path.join(templateRoot, template.htmlFile), 'utf8');
    const compile = handlebars.compile(source, { strict: true });

    for (const preview of template.previewCases) {
        const outputPath = path.join(outputRoot, `${template.id}--${preview.name}.html`);
        fs.writeFileSync(outputPath, compile(preview.data), 'utf8');
    }
}

process.stdout.write(`${outputRoot}\n`);
