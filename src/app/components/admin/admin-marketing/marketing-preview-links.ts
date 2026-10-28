/** Keep clicks in an email preview from replacing the rendered email. */
export function openPreviewLinksOutsideFrame(document: Document): void {
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (link.protocol !== 'https:' && link.protocol !== 'mailto:') continue;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
}
