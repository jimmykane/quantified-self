import { describe, expect, it } from 'vitest';
import { documentFromEditor, fillEditor } from './marketing-editor';

describe('admin marketing rich editor', () => {
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
  it('restores an editable document without treating text as HTML', () => {
    const root = document.createElement('div');
    fillEditor(root, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }] });
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toBe('<script>alert(1)</script>');
    expect(documentFromEditor(root).content[0].content?.[0].text).toBe('<script>alert(1)</script>');
  });
});
