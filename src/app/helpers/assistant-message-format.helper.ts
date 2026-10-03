import { Marked, Renderer } from 'marked';
import { getAppLocale } from '../shared/adapters/app-locale';
import { getDateTimeFormatter } from './date-time-format.helper';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Calendar labels are not instants: formatting in UTC preserves their original day. */
export function formatAssistantCalendarDate(value: string, locale = getAppLocale()): string {
  const date = parseCalendarDate(value);
  if (!date) return value;
  return getDateTimeFormatter(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(date);
}

export function formatAssistantCalendarRange(start: string, end: string, locale = getAppLocale()): string {
  const startDate = parseCalendarDate(start);
  const endDate = parseCalendarDate(end);
  if (!startDate || !endDate || startDate > endDate) {
    return `${formatAssistantCalendarDate(start, locale)} – ${formatAssistantCalendarDate(end, locale)}`;
  }
  return getDateTimeFormatter(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .formatRange(startDate, endDate);
}

/** Only standalone calendar dates in prose; never timestamps, filenames, IDs or URL paths. */
export function formatAssistantTextDates(text: string, locale = getAppLocale()): string {
  return text.replace(/(^|[^\w/\\.\-@])(\d{4}-\d{2}-\d{2})(?:(?:\s*[–—]\s*|\s+-\s+)(\d{4}-\d{2}-\d{2}))?(?![\w/\\\-@]|\.\w)/g,
    (_match, prefix: string, start: string, end: string | undefined) => `${prefix}${end
      ? formatAssistantCalendarRange(start, end, locale) : formatAssistantCalendarDate(start, locale)}`);
}

/** Untrusted model output gets Markdown formatting, never trusted HTML or remote images. */
export function renderAssistantMarkdown(text: string, locale = getAppLocale()): string {
  const renderer = new Renderer();
  renderer.text = function (token) {
    if ('tokens' in token && token.tokens) return this.parser.parseInline(token.tokens);
    return Renderer.prototype.text.call(this, { ...token, text: formatAssistantTextDates(token.text, locale) });
  };
  renderer.html = ({ text: html }) => escapeHtml(html);
  renderer.image = ({ text: alt }) => escapeHtml(alt);
  renderer.checkbox = ({ checked }) => checked ? '☑' : '☐';
  renderer.link = function ({ href, text: label, tokens }) {
    const body = label === href ? escapeHtml(label) : this.parser.parseInline(tokens);
    if (!/^https?:\/\//i.test(href)) return body;
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${body}</a>`;
  };
  renderer.heading = function ({ tokens }) {
    return `<h3>${this.parser.parseInline(tokens)}</h3>\n`;
  };
  renderer.table = function (token) {
    return `<div class="assistant-message-table" role="region" aria-label="Answer table" tabindex="0">${Renderer.prototype.table.call(this, token)}</div>`;
  };
  return new Marked({ renderer, async: false, gfm: true, breaks: true }).parse(text) as string;
}
