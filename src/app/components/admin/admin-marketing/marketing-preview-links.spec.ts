import { describe, expect, it } from 'vitest';
import { openPreviewLinksOutsideFrame } from './marketing-preview-links';

describe('email preview links', () => {
  it('opens safe email links outside the preview and leaves unsafe links confined', () => {
    const document = new DOMParser().parseFromString(
      '<a href="https://quantified-self.io/">Open</a><a href="mailto:hello@example.org">Reply</a><a href="javascript:alert(1)">Unsafe</a>',
      'text/html');
    openPreviewLinksOutsideFrame(document);
    const [site, email, unsafe] = [...document.querySelectorAll('a')];
    expect(site.target).toBe('_blank');
    expect(site.rel).toBe('noopener noreferrer');
    expect(email.target).toBe('_blank');
    expect(unsafe.target).toBe('');
  });
});
