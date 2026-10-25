export const WAHOO_SETUP_QUERY_PARAMS = { serviceName: 'Wahoo API' } as const;

/** Preserve only curated setup destinations through required onboarding. */
export function serviceSetupFromReturnUrl(value: unknown): { returnUrl: string; serviceName: string | null } | null {
  if (value === '/services') return { returnUrl: value, serviceName: null };
  if (typeof value !== 'string' || !value.startsWith('/services?') || value.includes('#')) return null;

  const entries = [...new URLSearchParams(value.slice('/services?'.length)).entries()];
  if (entries.length !== 1 || entries[0][0] !== 'serviceName' || entries[0][1] !== WAHOO_SETUP_QUERY_PARAMS.serviceName) return null;
  return {
    returnUrl: `/services?serviceName=${encodeURIComponent(WAHOO_SETUP_QUERY_PARAMS.serviceName)}`,
    serviceName: WAHOO_SETUP_QUERY_PARAMS.serviceName,
  };
}
