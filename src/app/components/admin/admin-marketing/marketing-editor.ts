import type { MarketingContentNode, MarketingDocument, MarketingTextMark } from '../../../../../shared/admin-marketing';

export function safeEditorLink(value: string): string | null {
  if (!value || value.length > 2048 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'mailto:') && !url.username && !url.password
      ? url.toString() : null;
  } catch { return null; }
}

export function hasVisibleMarketingText(document: MarketingDocument): boolean {
  const visible = (node: MarketingContentNode): boolean => node.type === 'text'
    ? !!node.text?.trim() : !!node.content?.some(visible);
  return document.content.some(visible);
}

function marksFor(element: Element, inherited: MarketingTextMark[]): MarketingTextMark[] {
  const tag = element.tagName.toLowerCase();
  const marks = [...inherited];
  if (tag === 'strong' || tag === 'b') marks.push({ type: 'bold' });
  if (tag === 'em' || tag === 'i') marks.push({ type: 'italic' });
  if (tag === 'a') {
    const href = element.getAttribute('href') || '';
    const url = safeEditorLink(href);
    if (url) marks.push({ type: 'link', attrs: { href: url } });
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
