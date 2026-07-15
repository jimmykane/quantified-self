import * as fs from 'fs';
import * as path from 'path';
import { REFRESHED_EMAIL_TEMPLATE_CATALOG } from '../email/template-catalog';
import { createLocalEmailTemplateRenderer } from '../email/template-renderer';

const templateRoot = path.resolve(__dirname, '../../templates');
const outputRoot = path.resolve(process.argv[2] || '/tmp/quantified-self-email-previews');
const renderer = createLocalEmailTemplateRenderer(templateRoot);

fs.mkdirSync(outputRoot, { recursive: true });

for (const template of REFRESHED_EMAIL_TEMPLATE_CATALOG) {
    for (const preview of template.previewCases) {
        const outputPath = path.join(outputRoot, `${template.id}--${preview.name}.html`);
        fs.writeFileSync(outputPath, renderer.render(template, preview.data).html, 'utf8');
    }
}

process.stdout.write(`${outputRoot}\n`);
