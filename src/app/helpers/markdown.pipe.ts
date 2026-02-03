import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LoggerService } from '../services/logger.service';

@Pipe({
    name: 'markdown',
    standalone: true
})
export class MarkdownPipe implements PipeTransform {
    private logger = inject(LoggerService);
    constructor(private sanitizer: DomSanitizer) { }

    async transform(value: string | undefined): Promise<SafeHtml> {
        if (!value) return '';

        try {
            // Lazy load marked only when needed
            const { marked } = await import('marked');
            const html = await marked.parse(value);
            return this.sanitizer.bypassSecurityTrustHtml(html as string);
        } catch (error) {
            this.logger.error('Error parsing markdown', error);
            return value;
        }
    }
}
