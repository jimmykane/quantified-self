import { describe, expect, it } from 'vitest';
import { onboardingResumeUrl, onboardingReturnTarget, onboardingStart, safeOnboardingResumeUrl } from './onboarding-navigation.helper';

describe('onboarding navigation', () => {
    it.each(['analyze', 'sync', 'compare', 'connect', 'upload', 'explore'])('preserves %s across checkout and reload', start => {
        const url = onboardingResumeUrl(new URLSearchParams({ start }));
        expect(url).toBe(`/onboarding?start=${start}`);
        expect(safeOnboardingResumeUrl(url)).toBe(url);
        expect(onboardingStart(start)).toBe(start);
    });

    it.each([
        { returnUrl: '/services?setup=sync', path: '/services', syncSetup: true },
        { returnUrl: '/services?serviceName=Suunto%20app', path: '/services', serviceName: 'Suunto app' },
        { returnUrl: '/subscriptions?priceId=price_pro_monthly', path: '/subscriptions', priceId: 'price_pro_monthly' },
        { returnUrl: '/mcp/authorize', request_id: 'request_123', path: '/mcp/authorize', requestId: 'request_123' },
        { returnUrl: '/tools/compare', path: '/tools/compare' },
        { returnUrl: '/tools/compare/saved', path: '/tools/compare/saved' },
    ])('round trips the existing $path destination', ({ returnUrl, request_id, ...expected }) => {
        const params = new URLSearchParams({ returnUrl, start: 'explore' });
        if (request_id) params.set('request_id', request_id);
        const resume = safeOnboardingResumeUrl(onboardingResumeUrl(params))!;
        const restored = new URLSearchParams(resume.slice(resume.indexOf('?') + 1));
        expect(onboardingReturnTarget(restored)).toMatchObject(expected);
        expect(restored.get('start')).toBe('explore');
    });

    it.each([
        'https://example.com/onboarding', '//example.com/onboarding', '/onboarding/../login',
        '/onboarding#anything', '/onboarding?start=connect&start=upload',
        '/onboarding?returnUrl=%2Fservices&returnUrl=%2Ftools%2Fcompare',
        '/onboarding?request_id=one&request_id=two', '', '/onboarding?' + 'x'.repeat(2048),
    ])('rejects an unsafe or ambiguous resume URL: %s', value => {
        expect(safeOnboardingResumeUrl(value)).toBeNull();
    });

    it('discards unknown flags and unsupported navigation without granting setup completion', () => {
        const resume = safeOnboardingResumeUrl('/onboarding?start=unknown&acceptedTos=true&onboardingCompleted=true&returnUrl=https%3A%2F%2Fexample.com');
        expect(resume).toBe('/onboarding');
        expect(onboardingStart('unknown')).toBeNull();
    });

    it('drops an invalid MCP request without widening the return destination', () => {
        expect(onboardingResumeUrl(new URLSearchParams({ returnUrl: '/mcp/authorize', request_id: 'bad/request' }))).toBe('/onboarding');
    });
});
