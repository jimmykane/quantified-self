const GARMIN_HEALTH_API_CALLBACK_HOST = 'apis.garmin.com';
const GARMIN_HEALTH_API_CALLBACK_PATH_PREFIX = '/wellness-api/rest/';

export class InvalidGarminCallbackUrlError extends Error {
    constructor() {
        super('Untrusted Garmin callback URL');
        this.name = 'InvalidGarminCallbackUrlError';
    }
}

export function normalizeTrustedGarminCallbackURL(callbackURL: string | null | undefined): string | null {
    if (!callbackURL) {
        return null;
    }

    let url: URL;
    try {
        url = new URL(callbackURL);
    } catch {
        return null;
    }

    if (url.protocol !== 'https:') {
        return null;
    }
    if (url.hostname.toLowerCase() !== GARMIN_HEALTH_API_CALLBACK_HOST) {
        return null;
    }
    if (url.port && url.port !== '443') {
        return null;
    }
    if (url.username || url.password) {
        return null;
    }
    if (!url.pathname.startsWith(GARMIN_HEALTH_API_CALLBACK_PATH_PREFIX)) {
        return null;
    }

    return url.toString();
}

export function assertTrustedGarminCallbackURL(callbackURL: string | null | undefined): string {
    const trustedURL = normalizeTrustedGarminCallbackURL(callbackURL);
    if (!trustedURL) {
        throw new InvalidGarminCallbackUrlError();
    }
    return trustedURL;
}
