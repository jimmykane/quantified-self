import { PendingTasks, Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LoggerService } from '../services/logger.service';

@Pipe({
    name: 'markdown',
    standalone: true
})
export class MarkdownPipe implements PipeTransform {
    private logger = inject(LoggerService);
    private readonly pendingTasks = inject(PendingTasks);
    constructor(private sanitizer: DomSanitizer) { }

    async transform(value: string | undefined): Promise<SafeHtml> {
        if (!value) return '';

        // Native dynamic imports are not automatically tracked by SSR stability.
        // Keep the lazy parser, but wait for its HTML before serializing the page.
        const finishTask = this.pendingTasks.add();
        try {
            // Lazy load marked only when needed
            const { marked } = await import('marked');
            const html = await marked.parse(value);
            return this.sanitizer.bypassSecurityTrustHtml(html as string);
        } catch (error) {
            this.logger.error('Error parsing markdown', error);
            return value;
        } finally {
            finishTask();
        }
    }
}
