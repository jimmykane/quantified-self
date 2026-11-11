export const SUUNTO_SETUP_QUERY_PARAMS = { serviceName: 'Suunto app' } as const;
export const WAHOO_SETUP_QUERY_PARAMS = { serviceName: 'Wahoo API' } as const;
export const COROS_SETUP_QUERY_PARAMS = { serviceName: 'COROS API' } as const;

const GUIDE_SETUP_SERVICE_NAMES: readonly string[] = [
  SUUNTO_SETUP_QUERY_PARAMS.serviceName,
  WAHOO_SETUP_QUERY_PARAMS.serviceName,
  COROS_SETUP_QUERY_PARAMS.serviceName,
];

/** Preserve only curated setup destinations through required onboarding. */
export function serviceSetupFromReturnUrl(value: unknown): { returnUrl: string; serviceName: string | null; setup?: 'sync' } | null {
  if (value === '/services') return { returnUrl: value, serviceName: null };
  if (typeof value !== 'string' || !value.startsWith('/services?') || value.includes('#')) return null;

  const entries = [...new URLSearchParams(value.slice('/services?'.length)).entries()];
  if (entries.some(([key]) => key === 'setup')) {
    const setup = entries.filter(([key]) => key === 'setup');
    const providers = entries.filter(([key]) => key === 'serviceName');
    if (setup.length !== 1 || setup[0][1] !== 'sync' || providers.length > 1
      || entries.length !== setup.length + providers.length) return null;
    const serviceName = providers[0]?.[1] ?? null;
    if (serviceName !== null && ![...GUIDE_SETUP_SERVICE_NAMES, 'Garmin API'].includes(serviceName)) return null;
    return { returnUrl: '/services?' + (serviceName ? `serviceName=${encodeURIComponent(serviceName)}&` : '') + 'setup=sync', serviceName, setup: 'sync' };
  }
  if (entries.length !== 1 || entries[0][0] !== 'serviceName' || !GUIDE_SETUP_SERVICE_NAMES.includes(entries[0][1])) return null;
  const serviceName = entries[0][1];
  return {
    returnUrl: `/services?serviceName=${encodeURIComponent(serviceName)}`,
    serviceName,
  };
}
