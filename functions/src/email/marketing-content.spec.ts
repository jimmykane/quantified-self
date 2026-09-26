import { describe, expect, it } from 'vitest';
import { renderMarketingContent, validateMarketingDraft } from './marketing-content';

const draft = {
  name: 'September update',
  subject: 'A note from Dimitrios',
  content: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'A new ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'feature', marks: [{ type: 'link', attrs: { href: 'https://quantified-self.io/features' } }] },
        { type: 'text', text: ' <script>alert(1)</script>' },
      ] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One benefit' }] }] },
      ] },
      { type: 'orderedList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First step' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second step' }] }] },
      ] },
    ],
  },
  cta: { label: 'Open QS', url: 'https://quantified-self.io' },
  filters: { plans: ['free', 'basic', 'pro'], signupFrom: null, signupTo: null },
};

describe('marketing content', () => {
  it('renders safe email HTML and plaintext from the allowlisted editor document', () => {
    const result = renderMarketingContent(validateMarketingDraft(draft));
    expect(result.bodyHtml).toContain('<strong>A new </strong>');
    expect(result.bodyHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.bodyHtml).not.toContain('<script>');
    expect(result.bodyHtml).toContain('<ul');
    expect(result.bodyText).toContain('One benefit');
    expect(result.bodyText).toContain('• One benefit');
    expect(result.bodyText).toContain('1. First step\n2. Second step');
    expect(result.bodyText).toContain('feature (https://quantified-self.io/features)');
    expect(result.ctaHtml).toContain('https://quantified-self.io/');
    expect(result.ctaHtml).toContain('font-size:14px;line-height:20px;');
    expect(result.ctaHtml).toContain('padding:2px 10px;');
    expect(result.ctaHtml).toContain('max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word;');
  });

  it.each([
    { content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://bad.example' } }] } },
    { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } },
    { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] } },
    { content: { type: 'doc', content: [{ type: 'text', text: 'Invalid top-level text' }] } },
    { cta: { label: 'Open', url: 'http://unsafe.example' } },
    { subject: 'Injected\r\nBcc: person@example.com' },
    { filters: { plans: ['free', 'free'], signupFrom: null, signupTo: null } },
  ])('rejects unsupported or unsafe input %#', change => {
    expect(() => validateMarketingDraft({ ...draft, ...change })).toThrow();
  });

  it('accepts the same content regardless of auth provider or email verification state', () => {
    // Eligibility belongs to the campaign worker, not the content format.
    expect(validateMarketingDraft(draft).filters.plans).toEqual(['free', 'basic', 'pro']);
  });
});
