import type {
  MarketingAudienceFilters,
  MarketingCampaignDraft,
  MarketingContentNode,
  MarketingDocument,
  MarketingTextMark,
} from '../../../shared/admin-marketing';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NODES = 500;
const MAX_TEXT_LENGTH = 20_000;

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanLine(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (!text || text.length > max || Array.from(text).some(character => character.charCodeAt(0) < 32)) {
    throw new Error(`${label} must contain 1-${max} printable characters.`);
  }
  return text;
}

export function safeMarketingUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || Array.from(value).some(character => character.charCodeAt(0) <= 32)) {
    throw new Error('Links must be valid HTTPS or mailto URLs.');
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Links must be valid HTTPS or mailto URLs.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'mailto:') {
    throw new Error('Links must be valid HTTPS or mailto URLs.');
  }
  if (url.username || url.password || (url.protocol === 'https:' && !url.hostname)) {
    throw new Error('Links cannot contain credentials.');
  }
  return url.toString();
}

function validDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value) ||
      (!Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value)) {
    throw new Error(`${label} must be a UTC calendar date.`);
  }
  return value;
}

function validateFilters(value: unknown): MarketingAudienceFilters {
  if (!plainObject(value) || !Array.isArray(value.plans)) throw new Error('Audience filters are required.');
  const plans = value.plans;
  if (plans.length === 0 || plans.length > 3 ||
      plans.some(plan => plan !== 'free' && plan !== 'basic' && plan !== 'pro') ||
      new Set(plans).size !== plans.length) {
    throw new Error('Choose one or more distinct plans.');
  }
  const signupFrom = validDate(value.signupFrom, 'Start date');
  const signupTo = validDate(value.signupTo, 'End date');
  if (signupFrom && signupTo && signupFrom > signupTo) throw new Error('Start date must precede end date.');
  return { plans: plans as MarketingAudienceFilters['plans'], signupFrom, signupTo };
}

function validateMarks(value: unknown): MarketingTextMark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 3) throw new Error('Unsupported text formatting.');
  const seen = new Set<string>();
  return value.map(mark => {
    if (!plainObject(mark) || (mark.type !== 'bold' && mark.type !== 'italic' && mark.type !== 'link') || seen.has(mark.type)) {
      throw new Error('Unsupported text formatting.');
    }
    seen.add(mark.type);
    if (mark.type === 'link') return { type: 'link', attrs: { href: safeMarketingUrl(plainObject(mark.attrs) ? mark.attrs.href : null) } };
    return { type: mark.type };
  });
}

function validateNode(value: unknown, depth: number, count: { nodes: number; chars: number; visible: boolean }): MarketingContentNode {
  if (!plainObject(value) || typeof value.type !== 'string' || depth > 6 || ++count.nodes > MAX_NODES) {
    throw new Error('Campaign body is too complex.');
  }
  const type = value.type;
  const allowed = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'hardBreak', 'text'];
  if (!allowed.includes(type)) throw new Error(`Unsupported content type: ${type}.`);
  if (type === 'text') {
    if (typeof value.text !== 'string') throw new Error('Text nodes need text.');
    count.chars += value.text.length;
    if (value.text.trim()) count.visible = true;
    if (count.chars > MAX_TEXT_LENGTH) throw new Error('Campaign body is too long.');
    const marks = validateMarks(value.marks);
    return { type: 'text', text: value.text, ...(marks ? { marks } : {}) };
  }
  if (type === 'hardBreak') return { type: 'hardBreak' };
  if (!Array.isArray(value.content)) throw new Error(`${type} needs content.`);
  if (type === 'heading' && (!plainObject(value.attrs) || value.attrs.level !== 2)) {
    throw new Error('Only level-two headings are supported.');
  }
  const content = value.content.map(child => validateNode(child, depth + 1, count));
  if ((type === 'paragraph' || type === 'heading') && content.some(child => child.type !== 'text' && child.type !== 'hardBreak')) {
    throw new Error(`${type} may contain text only.`);
  }
  if (type === 'listItem' && content.some(child => child.type !== 'paragraph')) throw new Error('List items must contain paragraphs.');
  if ((type === 'bulletList' || type === 'orderedList') && content.some(child => child.type !== 'listItem')) {
    throw new Error('Lists must contain list items.');
  }
  return { type: type as MarketingContentNode['type'], content, ...(type === 'heading' ? { attrs: { level: 2 } } : {}) };
}

export function validateMarketingDraft(value: unknown): MarketingCampaignDraft {
  if (!plainObject(value)) throw new Error('Campaign draft is required.');
  const name = cleanLine(value.name, 'Campaign name', 120);
  const subject = cleanLine(value.subject, 'Subject', 180);
  if (!plainObject(value.content) || value.content.type !== 'doc' || !Array.isArray(value.content.content) || !value.content.content.length) {
    throw new Error('Campaign body is required.');
  }
  const count = { nodes: 0, chars: 0, visible: false };
  const content: MarketingDocument = { type: 'doc', content: value.content.content.map(node => validateNode(node, 0, count)) };
  if (content.content.some(node => !['paragraph', 'heading', 'bulletList', 'orderedList'].includes(node.type))) {
    throw new Error('Campaign body must contain paragraphs, headings, or lists.');
  }
  if (!count.visible) throw new Error('Campaign body needs text.');
  let cta: MarketingCampaignDraft['cta'] = null;
  if (value.cta !== null && value.cta !== undefined) {
    if (!plainObject(value.cta)) throw new Error('Call to action is invalid.');
    cta = { label: cleanLine(value.cta.label, 'Button label', 80), url: safeMarketingUrl(value.cta.url) };
    if (!cta.url.startsWith('https:')) throw new Error('Button must link to HTTPS.');
  }
  return { name, subject, content, cta, filters: validateFilters(value.filters) };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

function renderNode(node: MarketingContentNode): { html: string; text: string } {
  if (node.type === 'text') {
    const content = node.text || '';
    let html = escapeHtml(content);
    for (const mark of node.marks || []) {
      if (mark.type === 'bold') html = `<strong>${html}</strong>`;
      if (mark.type === 'italic') html = `<em>${html}</em>`;
      if (mark.type === 'link') html = `<a href="${escapeHtml(mark.attrs?.href || '')}" style="color:#174ea6;">${html}</a>`;
    }
    const link = node.marks?.find(mark => mark.type === 'link')?.attrs?.href;
    return { html, text: link && content.trim() !== link ? `${content} (${link})` : content };
  }
  if (node.type === 'hardBreak') return { html: '<br>', text: '\n' };
  const rendered = (node.content || []).map(renderNode);
  const innerHtml = rendered.map(item => item.html).join('');
  const innerText = rendered.map(item => item.text).join('');
  if (node.type === 'paragraph') return { html: `<p style="margin:0 0 24px;">${innerHtml}</p>`, text: `${innerText}\n\n` };
  if (node.type === 'heading') return { html: `<h2 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:27px;margin:0 0 16px;">${innerHtml}</h2>`, text: `${innerText}\n\n` };
  if (node.type === 'listItem') return { html: `<li style="margin:0 0 8px;">${innerHtml}</li>`, text: innerText.trim() };
  if (node.type === 'bulletList') return { html: `<ul style="margin:0 0 24px;padding-left:24px;">${innerHtml}</ul>`,
    text: `${rendered.map(item => `• ${item.text}\n`).join('')}\n` };
  return { html: `<ol style="margin:0 0 24px;padding-left:24px;">${innerHtml}</ol>`,
    text: `${rendered.map((item, index) => `${index + 1}. ${item.text}\n`).join('')}\n` };
}

export function renderMarketingContent(draft: MarketingCampaignDraft): { bodyHtml: string; bodyText: string; ctaHtml: string; ctaText: string } {
  const content = draft.content.content.map(renderNode);
  const ctaHtml = draft.cta
    ? `<p style="margin:0 0 28px;"><a href="${escapeHtml(draft.cta.url)}" style="display:inline-block;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word;background:#174ea6;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;padding:9px 14px;border-radius:4px;">${escapeHtml(draft.cta.label)}</a></p>`
    : '';
  const ctaText = draft.cta ? `${draft.cta.label}: ${draft.cta.url}\n\n` : '';
  return { bodyHtml: content.map(item => item.html).join(''), bodyText: content.map(item => item.text).join('').trim(), ctaHtml, ctaText };
}
