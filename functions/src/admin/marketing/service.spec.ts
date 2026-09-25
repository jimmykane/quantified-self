import { describe, expect, it } from 'vitest';
import type { UserRecord } from 'firebase-admin/auth';
import { JSDOM } from 'jsdom';
import { authAllowed, checkedTestEmail, makeUnsubscribeToken, previewCampaign, verifyUnsubscribeToken } from './service';

const draft = {
  name: 'Product update', subject: 'A note from Dimitrios',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello & welcome.' }] }] },
  cta: { label: 'Open Quantified Self', url: 'https://quantified-self.io/dashboard' },
  filters: { plans: ['free', 'basic', 'pro'], signupFrom: null, signupTo: null },
};

describe('marketing audience and content', () => {
  it('accepts one test address and rejects malformed or injected recipients', () => {
    expect(checkedTestEmail('  qa+campaign@example.org  ')).toBe('qa+campaign@example.org');
    for (const value of ['', 'one@example.org,two@example.org', 'Name <one@example.org>',
      'one@example.org\r\nBcc:other@example.org', 'one@localhost', 42]) {
      expect(() => checkedTestEmail(value)).toThrow();
    }
  });
  it.each(['password', 'google.com', 'github.com'])('accepts consented %s accounts even when emailVerified is false', providerId => {
    const user = { uid: 'uid', email: 'person@example.com', emailVerified: false, disabled: false,
      customClaims: {}, providerData: [{ providerId }] } as UserRecord;
    expect(authAllowed(user)).toBe(true);
    expect(authAllowed({ ...user, disabled: true } as UserRecord)).toBe(false);
    expect(authAllowed({ ...user, customClaims: { admin: true } } as UserRecord)).toBe(false);
  });
  it('renders safe HTML and plaintext with a campaign footer and unchanged founder shell', () => {
    const message = previewCampaign(draft);
    expect(message.subject).toBe(draft.subject);
    expect(previewCampaign({ ...draft, subject: "Dimitrios's update" }).text).toContain("Dimitrios's update");
    expect(message.html).toContain('Hello &amp; welcome.');
    expect(message.html).toContain('Unsubscribe from product updates');
    expect(message.html).toContain('/email/unsubscribe?test&#x3D;1');
    expect(message.html).toContain('max-width:600px');
    expect(message.text).toContain('Hello & welcome.');
    expect(message.text).toContain('Unsubscribe from product updates');
    expect(message.text).toContain('/email/unsubscribe?test=1');
    expect(message.text).not.toContain('&#x3D;');
    const document = new JSDOM(message.html).window.document;
    const letter = document.querySelector('table.letter');
    const body = letter?.querySelector('td.letter-body');
    const footer = [...(letter?.querySelectorAll('td') || [])]
      .find(cell => cell.textContent?.includes('Unsubscribe from product updates'));
    expect(body?.textContent).toContain('Hi friend');
    expect(body?.textContent).toContain('Hello & welcome.');
    expect(body?.textContent).toContain('Best regards');
    expect(body?.querySelector('a[style*="background"]')?.textContent).toBe('Open Quantified Self');
    expect(footer?.textContent).toContain('You received this product update');
    expect(footer?.querySelector('a[href*="unsubscribe"]')).not.toBeNull();
  });
  it('escapes body markup before the admin preview trusts the rendered template', () => {
    const hostile = previewCampaign({ ...draft, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ] } });
    expect(hostile.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(hostile.html).not.toContain('<img');
  });
  it('verifies signed unsubscribe tokens and rejects tampering', () => {
    const token = makeUnsubscribeToken('user_123', 'a-long-local-test-secret');
    expect(verifyUnsubscribeToken(token, 'a-long-local-test-secret')).toBe('user_123');
    expect(verifyUnsubscribeToken(makeUnsubscribeToken('a', 'a-long-local-test-secret'), 'a-long-local-test-secret')).toBe('a');
    expect(verifyUnsubscribeToken(token, 'another-secret')).toBeNull();
    expect(verifyUnsubscribeToken(`x${token.slice(1)}`, 'a-long-local-test-secret')).toBeNull();
  });
});
