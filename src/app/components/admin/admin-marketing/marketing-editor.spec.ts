import { describe, expect, it } from 'vitest';
import { documentFromEditor, hasVisibleMarketingText, safeEditorLink } from './marketing-editor';

describe('admin marketing rich editor', () => {
  it('validates link schemes and detects actual body text before previewing', () => {
    expect(safeEditorLink('https://example.org/path')).toBe('https://example.org/path');
    expect(safeEditorLink('mailto:test@example.org')).toBe('mailto:test@example.org');
    expect(safeEditorLink('javascript:alert(1)')).toBeNull();
    expect(safeEditorLink('https://user:pass@example.org')).toBeNull();
    expect(hasVisibleMarketingText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }] })).toBe(false);
    expect(hasVisibleMarketingText({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A note' }] },
    ] }] }] })).toBe(true);
  });
  it('keeps paragraphs, emphasis, lists, and safe links in structured content', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Hello <strong>world</strong> <a href="https://quantified-self.io">open</a> <a href="javascript:alert(1)">unsafe</a></p><ul><li>First</li><li>Second</li></ul>';
    const documentValue = documentFromEditor(root);
    expect(documentValue.content.map(node => node.type)).toEqual(['paragraph', 'bulletList']);
    const paragraph = documentValue.content[0].content || [];
    expect(paragraph.find(node => node.text === 'world')?.marks).toEqual([{ type: 'bold' }]);
    expect(paragraph.find(node => node.text === 'open')?.marks?.[0].attrs?.href).toBe('https://quantified-self.io/');
    expect(paragraph.find(node => node.text === 'unsafe')?.marks).toBeUndefined();
    expect(documentValue.content[1].content).toHaveLength(2);
  });
});
