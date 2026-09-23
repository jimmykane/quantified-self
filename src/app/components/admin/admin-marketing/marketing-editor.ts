import type { MarketingContentNode, MarketingDocument, MarketingTextMark } from '../../../../../shared/admin-marketing';

function marksFor(element: Element, inherited: MarketingTextMark[]): MarketingTextMark[] {
  const tag = element.tagName.toLowerCase();
  const marks = [...inherited];
  if (tag === 'strong' || tag === 'b') marks.push({ type: 'bold' });
  if (tag === 'em' || tag === 'i') marks.push({ type: 'italic' });
  if (tag === 'a') {
    const href = element.getAttribute('href') || '';
    try {
      const url = new URL(href);
      if (url.protocol === 'https:' || url.protocol === 'mailto:') marks.push({ type: 'link', attrs: { href: url.toString() } });
    } catch { /* Invalid pasted links become plain text. */ }
  }
  return marks.filter((mark, index) => marks.findIndex(item => item.type === mark.type) === index);
}
function inline(nodes: NodeListOf<ChildNode> | ChildNode[], marks: MarketingTextMark[] = []): MarketingContentNode[] {
  const result: MarketingContentNode[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text) result.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
    } else if (node instanceof HTMLElement) {
      if (node.tagName.toLowerCase() === 'script' || node.tagName.toLowerCase() === 'style') continue;
      if (node.tagName.toLowerCase() === 'br') result.push({ type: 'hardBreak' });
      else result.push(...inline(node.childNodes as NodeListOf<ChildNode>, marksFor(node, marks)));
    }
  }
  return result;
}
function block(node: ChildNode): MarketingContentNode[] {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ? [{ type: 'paragraph', content: inline([node]) }] : [];
  if (!(node instanceof HTMLElement)) return [];
  const tag = node.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') return [{ type: tag === 'ul' ? 'bulletList' : 'orderedList', content:
    Array.from(node.children).filter(child => child.tagName.toLowerCase() === 'li').map(child => ({
      type: 'listItem', content: [{ type: 'paragraph', content: inline(child.childNodes as NodeListOf<ChildNode>) }],
    })) }];
  if (tag === 'h2') return [{ type: 'heading', attrs: { level: 2 }, content: inline(node.childNodes as NodeListOf<ChildNode>) }];
  if (tag === 'div' || tag === 'p' || tag === 'h1' || tag === 'h3') return [{ type: 'paragraph', content: inline(node.childNodes as NodeListOf<ChildNode>) }];
  return [{ type: 'paragraph', content: inline([node]) }];
}
export function documentFromEditor(element: HTMLElement): MarketingDocument {
  const content = Array.from(element.childNodes).flatMap(block);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}
function appendInline(parent: HTMLElement, item: MarketingContentNode): void {
  if (item.type === 'hardBreak') { parent.append(document.createElement('br')); return; }
  if (item.type !== 'text') return;
  let node: Node = document.createTextNode(item.text || '');
  for (const mark of item.marks || []) {
    let element: HTMLElement;
    if (mark.type === 'bold') element = document.createElement('strong');
    else if (mark.type === 'italic') element = document.createElement('em');
    else {
      element = document.createElement('a');
      if (mark.attrs?.href?.startsWith('https:') || mark.attrs?.href?.startsWith('mailto:')) element.setAttribute('href', mark.attrs.href);
    }
    element.append(node); node = element;
  }
  parent.append(node);
}
function makeBlock(item: MarketingContentNode): HTMLElement {
  const element = document.createElement(item.type === 'heading' ? 'h2' : item.type === 'bulletList' ? 'ul' : item.type === 'orderedList' ? 'ol' : item.type === 'listItem' ? 'li' : 'p');
  if (item.type === 'bulletList' || item.type === 'orderedList') {
    for (const child of item.content || []) element.append(makeBlock(child));
  } else if (item.type === 'listItem') {
    for (const child of item.content || []) for (const inlineNode of ('content' in child ? child.content || [] : [])) appendInline(element, inlineNode);
  } else for (const child of item.content || []) appendInline(element, child);
  return element;
}
export function fillEditor(element: HTMLElement, content: MarketingDocument): void {
  element.replaceChildren(...content.content.map(makeBlock));
}
