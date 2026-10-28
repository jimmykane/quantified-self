import { describe, expect, it } from 'vitest';
import { formatAssistantCalendarDate, formatAssistantCalendarRange, formatAssistantTextDates, renderAssistantMarkdown } from './assistant-message-format.helper';

function rendered(text: string): HTMLDivElement {
  const element = document.createElement('div');
  element.innerHTML = renderAssistantMarkdown(text, 'en-GB');
  return element;
}

describe('Assistant message formatting', () => {
  it('renders headings, emphasis, lists and line breaks rather than raw Markdown', () => {
    const element = rendered('## Your recovery\n\n**From your records**\n- Two activities today\n- *Take it easy*\n\nFirst line\nSecond line');
    expect(element.querySelector('h3')?.textContent).toBe('Your recovery');
    expect(element.querySelector('strong')?.textContent).toBe('From your records');
    expect(element.querySelectorAll('li')).toHaveLength(2);
    expect(element.querySelector('em')?.textContent).toBe('Take it easy');
    expect(element.querySelector('br')).not.toBeNull();
    expect(element.textContent).not.toContain('**');
  });

  it('formats valid calendar dates and ranges without changing their day', () => {
    expect(formatAssistantTextDates('Belly Pain: 2026-09-04–2026-09-10 (ended).', 'en-GB').replace(/\s+/g, ' '))
      .toBe('Belly Pain: 4 – 10 Sept 2026 (ended).');
    expect(formatAssistantTextDates('Until 2026-10-01.', 'en-GB')).toBe('Until 1 Oct 2026.');
    expect(formatAssistantCalendarDate('2028-02-29', 'en-US')).toBe('Feb 29, 2028');
    expect(formatAssistantCalendarDate('2026-10-25', 'de-DE')).toBe('25. Okt. 2026');
    expect(formatAssistantCalendarDate('2026-03-29', 'en-GB')).toBe('29 Mar 2026');
  });

  it('formats same-day, month/year boundaries and reversed ranges without inventing dates', () => {
    expect(formatAssistantCalendarRange('2026-09-04', '2026-09-04', 'en-GB')).toBe('4 Sept 2026');
    expect(formatAssistantCalendarRange('2026-09-29', '2026-10-02', 'en-GB').replace(/\s+/g, ' ')).toBe('29 Sept – 2 Oct 2026');
    expect(formatAssistantCalendarRange('2026-12-31', '2027-01-02', 'en-GB').replace(/\s+/g, ' ')).toBe('31 Dec 2026 – 2 Jan 2027');
    expect(formatAssistantCalendarRange('2026-09-10', '2026-09-04', 'en-GB')).toBe('10 Sept 2026 – 4 Sept 2026');
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-01-00', 'unknown'])('leaves an invalid calendar date unchanged: %s', value => {
    expect(formatAssistantCalendarDate(value, 'en-GB')).toBe(value);
  });

  it('preserves timestamps, IDs, filenames, code and link destinations', () => {
    const text = '2026-09-04T12:00:00.000Z file-2026-09-04.fit 2026-09-04.csv ref_2026-09-04';
    expect(formatAssistantTextDates(text, 'en-GB')).toBe(text);
    const element = rendered('On 2026-09-04. `2026-09-04`\n\n```json\n{"date":"2026-09-04"}\n```\n\n[Open day](https://quantified-self.io/calendar/day/2026-09-04)\n\nhttps://example.com/2026-09-04');
    expect(element.textContent).toContain('On 4 Sept 2026.');
    expect(element.querySelector('code')?.textContent).toBe('2026-09-04');
    expect(element.querySelector('pre')?.textContent).toContain('"date":"2026-09-04"');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('https://quantified-self.io/calendar/day/2026-09-04');
    expect(element.querySelectorAll('a')[1].textContent).toBe('https://example.com/2026-09-04');
  });

  it('treats raw HTML as text, omits external images and rejects unsafe links', () => {
    const element = rendered('<script>alert(1)</script>\n\n<img src="https://example.com/track" onerror="alert(1)">\n\n![chart](https://example.com/track)\n\n[Bad](javascript:alert%281%29) [Data](data:text/html,test) [Good](https://example.com/?x=1&y=2)');
    expect(element.querySelector('script, img, iframe, input')).toBeNull();
    expect(element.textContent).toContain('<script>alert(1)</script>');
    expect(element.textContent).toContain('chart');
    expect(element.querySelectorAll('a')).toHaveLength(1);
    expect(element.querySelector('a')?.getAttribute('href')).toBe('https://example.com/?x=1&y=2');
    expect(element.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('escapes text and retains ordinary ampersands and Markdown escapes', () => {
    const element = rendered('Load & sleep. \\*literal\\*. **A & B**');
    expect(element.textContent).toContain('Load & sleep. *literal*. A & B');
    expect(element.querySelector('strong')?.textContent).toBe('A & B');
  });

  it('gives wide tables their own keyboard-accessible scroll region', () => {
    const element = rendered('| Day | Duration |\n| --- | --- |\n| 2026-09-04 | 40m |');
    expect(element.querySelector('[role="region"]')?.getAttribute('tabindex')).toBe('0');
    expect(element.querySelector('td')?.textContent).toBe('4 Sept 2026');
  });

  it('renders checklist status without introducing interactive form controls', () => {
    const element = rendered('- [x] Completed\n- [ ] Planned');
    expect(element.textContent).toContain('☑ Completed');
    expect(element.textContent).toContain('☐ Planned');
    expect(element.querySelector('input')).toBeNull();
  });
});
