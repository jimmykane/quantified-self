export const WAHOO_SETUP_QUERY_PARAMS = { serviceName: 'Wahoo API' } as const;
export const COROS_SETUP_QUERY_PARAMS = { serviceName: 'COROS API' } as const;

const GUIDE_SETUP_SERVICE_NAMES: readonly string[] = [
  WAHOO_SETUP_QUERY_PARAMS.serviceName,
  COROS_SETUP_QUERY_PARAMS.serviceName,
];

/** Preserve only curated setup destinations through required onboarding. */
export function serviceSetupFromReturnUrl(value: unknown): { returnUrl: string; serviceName: string | null } | null {
  if (value === '/services') return { returnUrl: value, serviceName: null };
  if (typeof value !== 'string' || !value.startsWith('/services?') || value.includes('#')) return null;

  const entries = [...new URLSearchParams(value.slice('/services?'.length)).entries()];
  if (entries.length !== 1 || entries[0][0] !== 'serviceName' || !GUIDE_SETUP_SERVICE_NAMES.includes(entries[0][1])) return null;
  const serviceName = entries[0][1];
  return {
    returnUrl: `/services?serviceName=${encodeURIComponent(serviceName)}`,
    serviceName,
  };
}
