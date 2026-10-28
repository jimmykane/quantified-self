import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { MarketingRichEditorComponent } from './marketing-rich-editor.component';
import { AppHapticsService } from '../../../services/app.haptics.service';

describe('MarketingRichEditorComponent', () => {
  it('does not emit message edits when locking, unlocking or loading saved content', () => {
    const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AppHapticsService, useValue: haptics }] });
    const fixture = TestBed.createComponent(MarketingRichEditorComponent);
    fixture.componentRef.setInput('value', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved email' }] }] });
    fixture.detectChanges();
    const emitted = vi.fn();
    fixture.componentInstance.valueChange.subscribe(emitted);
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    fixture.componentRef.setInput('disabled', false); fixture.detectChanges();
    fixture.componentRef.setInput('value', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Refreshed saved email' }] }] });
    fixture.detectChanges();
    expect(emitted).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    const editor = Reflect.get(fixture.componentInstance, 'editor') as Editor;
    editor.commands.insertContent(' edited');
    expect(emitted).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('hydrates structured content, emits edits, and locks prepared campaigns', () => {
    const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AppHapticsService, useValue: haptics }] });
    const fixture = TestBed.createComponent(MarketingRichEditorComponent);
    fixture.componentRef.setInput('value', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }] });
    fixture.detectChanges();
    const editor = Reflect.get(fixture.componentInstance, 'editor') as Editor;
    expect(editor.getText()).toBe('Draft');
    expect(haptics.selection).not.toHaveBeenCalled();

    const emitted = vi.fn();
    fixture.componentInstance.valueChange.subscribe(emitted);
    editor.commands.insertContent(' updated');
    expect(emitted).toHaveBeenCalled();
    expect(emitted.mock.lastCall?.[0].content[0].content[0].text).toContain('updated');

    editor.commands.setTextSelection({ from: 1, to: 6 });
    fixture.nativeElement.querySelector('button[aria-label="Bold"]')?.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tiptap strong')?.textContent).toBeTruthy();
    expect(haptics.selection).toHaveBeenCalled();

    editor.commands.setTextSelection({ from: 1, to: 6 });
    fixture.componentInstance.linkUrl = 'https://example.org';
    fixture.componentInstance.applyLink();
    expect(fixture.nativeElement.querySelector('.tiptap a')?.getAttribute('href')).toBe('https://example.org/');
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(fixture.componentInstance.linkOpen).toBe(true);

    fixture.componentRef.setInput('value', { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '<script>alert(1)</script>' },
    ] }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(editor.getText()).toBe('<script>alert(1)</script>');

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(editor.isEditable).toBe(false);
    fixture.destroy();
    expect(editor.isDestroyed).toBe(true);
  });
});
