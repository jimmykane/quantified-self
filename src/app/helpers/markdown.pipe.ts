import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
    name: 'markdown',
    standalone: true
})
export class MarkdownPipe implements PipeTransform {
    constructor(private sanitizer: DomSanitizer) { }

    async transform(value: string | undefined): Promise<SafeHtml> {
        if (!value) return '';

        try {
            // Lazy load marked only when needed
            const { marked } = await import('marked');
            const html = await marked.parse(value);
            return this.sanitizer.bypassSecurityTrustHtml(html as string);
        } catch (error) {
            console.error('Error parsing markdown', error);
            return value;
        }
    }
}
