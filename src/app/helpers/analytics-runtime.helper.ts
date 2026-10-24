interface AnalyticsEnvironment {
  production: boolean;
  beta: boolean;
  localhost: boolean;
  appVersion: string;
  firebase: { projectId: string };
}

interface AnalyticsPage {
  isBrowser: boolean;
  href: string;
  referrer: string;
}

interface AnalyticsSettings {
  config: {
    app_name: string;
    app_version: string;
    debug_mode: false;
    ignore_referrer?: true;
  };
}

const PAYMENT_REFERRERS = new Set(['checkout.stripe.com', 'billing.stripe.com']);
const OAUTH_REFERRERS: Readonly<Record<string, string>> = {
  'Garmin API': 'connect.garmin.com',
  'Suunto app': 'cloudapi-oauth.suunto.com',
  'COROS API': 'open.coros.com',
  'Wahoo API': 'api.wahooligan.com',
};

/** Gate SDK initialization itself, including its automatic first page view. */
export function initializeProductionAnalytics<T>(
  environment: AnalyticsEnvironment,
  page: AnalyticsPage,
  initialize: (settings: AnalyticsSettings) => T,
): T | null {
  if (!page.isBrowser || !environment.production || environment.beta || environment.localhost) {
    return null;
  }
  const location = httpsUrl(page.href);
  if (location?.origin !== 'https://quantified-self.io') {
    return null;
  }

  const config: AnalyticsSettings['config'] = {
    app_name: environment.firebase.projectId,
    app_version: environment.appVersion,
    debug_mode: false,
  };
  if (isKnownFlowReturn(location, page.referrer, environment.firebase.projectId)) {
    config.ignore_referrer = true;
  }
  // Omit ignore_referrer on every other entry. Even false suppresses referrals in GA4.
  return initialize({ config });
}

function isKnownFlowReturn(location: URL, referrer: string, projectId: string): boolean {
  const previous = httpsUrl(referrer);
  if (!previous) {
    return false;
  }
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/payment/success' || path === '/payment/cancel') {
    return PAYMENT_REFERRERS.has(previous.hostname);
  }
  if (path === '/login') {
    return previous.hostname === `${projectId}.firebaseapp.com`;
  }
  return path === '/services'
    && location.searchParams.get('connect') === '1'
    && OAUTH_REFERRERS[location.searchParams.get('serviceName') ?? ''] === previous.hostname;
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Internal entry points are product context, never campaign attribution. */
export function analyticsEventParameters(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params || !Object.prototype.hasOwnProperty.call(params, 'source')) {
    return params;
  }
  const { source, ...eventParams } = params;
  const interactionSource = eventParams.interaction_source ?? source;
  return interactionSource === undefined ? eventParams : { ...eventParams, interaction_source: interactionSource };
}
