import { PendingTasks } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownPipe } from './markdown.pipe';
import { LoggerService } from '../services/logger.service';

vi.mock('marked', () => ({ marked: { parse: vi.fn() } }));

describe('MarkdownPipe server rendering stability', () => {
    const finishTask = vi.fn();
    const add = vi.fn(() => finishTask);
    const trustHtml = vi.fn(value => value);
    const logger = { error: vi.fn() };
    const parse = vi.mocked(marked.parse);

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({ providers: [
            MarkdownPipe,
            { provide: PendingTasks, useValue: { add } },
            { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: trustHtml } },
            { provide: LoggerService, useValue: logger },
        ] });
    });

    it('keeps the app pending until the lazy parser finishes the rendered HTML', async () => {
        let finishParsing!: (value: string) => void;
        parse.mockImplementation(() => new Promise<string>(resolve => { finishParsing = resolve; }));
        const rendered = TestBed.inject(MarkdownPipe).transform('**Published** changes');
        expect(add).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(parse).toHaveBeenCalled());
        expect(finishTask).not.toHaveBeenCalled();

        finishParsing('<p><strong>Published</strong> changes</p>');
        await expect(rendered).resolves.toBe('<p><strong>Published</strong> changes</p>');
        expect(trustHtml).toHaveBeenCalledWith('<p><strong>Published</strong> changes</p>');
        expect(finishTask).toHaveBeenCalledOnce();
    });

    it('releases stability on parser failure and preserves the existing text fallback', async () => {
        parse.mockRejectedValue(new Error('Synthetic parser failure'));
        await expect(TestBed.inject(MarkdownPipe).transform('Published changes')).resolves.toBe('Published changes');
        expect(finishTask).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('does not schedule parsing or pending work for empty content', async () => {
        await expect(TestBed.inject(MarkdownPipe).transform(undefined)).resolves.toBe('');
        expect(add).not.toHaveBeenCalled();
        expect(parse).not.toHaveBeenCalled();
    });
});
