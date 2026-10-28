/** Public entry aliases; keep Firebase Hosting redirects aligned with these routes. */
export const PUBLIC_ENTRY_REDIRECTS = [
  { path: 'membership', destination: '/pricing' },
  { path: 'help/getting-started', destination: '/help#getting-started' },
  { path: 'help/plans-and-billing', destination: '/help#plans-and-billing' },
  { path: 'help/plans-billing', destination: '/help#plans-and-billing' },
] as const;
