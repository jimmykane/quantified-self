import { membershipPriceIdFromReturnUrl } from './membership-selection.helper';
import { serviceSetupFromReturnUrl } from './service-setup-redirect.helper';

// Keep connect/upload for existing bookmarks and checkout returns.
export type OnboardingStart = 'analyze' | 'sync' | 'compare' | 'connect' | 'upload' | 'explore';
type QueryParams = { get(name: string): string | null };

export function onboardingStart(value: string | null): OnboardingStart | null {
    return value === 'analyze' || value === 'sync' || value === 'compare' || value === 'connect' || value === 'upload' || value === 'explore' ? value : null;
}

export function onboardingReturnTarget(params: QueryParams) {
    const returnUrl = params.get('returnUrl');
    const priceId = membershipPriceIdFromReturnUrl(returnUrl);
    const serviceSetup = serviceSetupFromReturnUrl(returnUrl);
    const requestId = params.get('request_id') || '';
    // Keep destinations explicit; never accept an external/client OAuth callback here.
    const path = priceId ? '/subscriptions'
        : serviceSetup ? '/services'
            : returnUrl === '/tools/compare' || returnUrl === '/tools/compare/saved' || returnUrl === '/subscriptions' ? returnUrl
                : returnUrl === '/mcp/authorize' && /^[A-Za-z0-9_-]{1,256}$/.test(requestId)
                    ? '/mcp/authorize' : '/dashboard';
    const label = path === '/tools/compare' || path === '/tools/compare/saved' ? 'Compare'
        : path === '/subscriptions' ? 'Membership'
            : path === '/services' ? 'Connections'
                : path === '/mcp/authorize' ? 'MCP connection' : 'Dashboard';
    return { path, label, priceId, requestId, serviceName: serviceSetup?.serviceName ?? null, syncSetup: serviceSetup?.setup === 'sync' };
}

/** Navigation intent only: never grants consent, access, or onboarding completion. */
export function onboardingResumeUrl(params: QueryParams, start = onboardingStart(params.get('start'))): string {
    const query = new URLSearchParams();
    if (start) query.set('start', start);
    const target = onboardingReturnTarget(params);
    if (target.path !== '/dashboard') {
        const destinationQuery = new URLSearchParams();
        if (target.priceId) destinationQuery.set('priceId', target.priceId);
        if (target.serviceName) destinationQuery.set('serviceName', target.serviceName);
        if (target.syncSetup) destinationQuery.set('setup', 'sync');
        query.set('returnUrl', target.path + (destinationQuery.size ? `?${destinationQuery}` : ''));
        if (target.path === '/mcp/authorize') query.set('request_id', target.requestId);
    }
    return '/onboarding' + (query.size ? `?${query}` : '');
}

export function safeOnboardingResumeUrl(value: string | null | undefined): string | null {
    if (!value || value.length > 2048 || value.includes('#')) return null;
    const [path, query = ''] = value.split('?');
    if (path !== '/onboarding') return null;
    const params = new URLSearchParams(query);
    if (['start', 'returnUrl', 'request_id'].some(key => params.getAll(key).length > 1)) return null;
    return onboardingResumeUrl(params);
}
