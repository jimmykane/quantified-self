import { describe, expect, it } from 'vitest';
import type { UserRecord } from 'firebase-admin/auth';
import { authAllowed, makeUnsubscribeToken, previewCampaign, verifyUnsubscribeToken } from './service';

const draft = {
  name: 'Product update', subject: 'A note from Dimitrios',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello & welcome.' }] }] },
  cta: { label: 'Open Quantified Self', url: 'https://quantified-self.io/dashboard' },
  filters: { plans: ['free', 'basic', 'pro'], signupFrom: null, signupTo: null },
};

describe('marketing audience and content', () => {
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
    expect(message.html).toContain('max-width:600px');
    expect(message.text).toContain('Hello & welcome.');
    expect(message.text).toContain('Unsubscribe from product updates');
  });
  it('verifies signed unsubscribe tokens and rejects tampering', () => {
    const token = makeUnsubscribeToken('user_123', 'a-long-local-test-secret');
    expect(verifyUnsubscribeToken(token, 'a-long-local-test-secret')).toBe('user_123');
    expect(verifyUnsubscribeToken(makeUnsubscribeToken('a', 'a-long-local-test-secret'), 'a-long-local-test-secret')).toBe('a');
    expect(verifyUnsubscribeToken(token, 'another-secret')).toBeNull();
    expect(verifyUnsubscribeToken(`x${token.slice(1)}`, 'a-long-local-test-secret')).toBeNull();
  });
});
