import {
    GarminSupportedSummaryType,
    isGarminSupportedSummaryType,
} from '../garmin/health-summary-types';

const GARMIN_HEALTH_API_CALLBACK_HOST = 'apis.garmin.com';
const GARMIN_HEALTH_API_MAX_UPLOAD_WINDOW_SECONDS = 24 * 60 * 60;
const GARMIN_HEALTH_API_MAX_CALLBACK_URL_LENGTH = 8 * 1024;

export interface TrustedGarminCallback {
    callbackURL: string;
    summaryType: GarminSupportedSummaryType;
    uploadStartTimeMs: number;
    uploadEndTimeMs: number;
}

export class InvalidGarminCallbackUrlError extends Error {
    constructor() {
        super('Untrusted Garmin callback URL');
        this.name = 'InvalidGarminCallbackUrlError';
    }
}

function parseUploadTimeSeconds(url: URL, field: string): number | null {
    const values = url.searchParams.getAll(field);
    if (values.length !== 1 || !/^\d{1,10}$/.test(values[0])) return null;
    const seconds = Number(values[0]);
    return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

export function parseTrustedGarminCallbackURL(
    callbackURL: string | null | undefined,
    expectedSummaryType?: GarminSupportedSummaryType,
): TrustedGarminCallback | null {
    if (!callbackURL || callbackURL.length > GARMIN_HEALTH_API_MAX_CALLBACK_URL_LENGTH) {
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
    if (url.hash) {
        return null;
    }
    const pathMatch = /^\/wellness-api\/rest\/([A-Za-z]+)$/.exec(url.pathname);
    const summaryType = pathMatch?.[1];
    if (!isGarminSupportedSummaryType(summaryType)
        || (expectedSummaryType && summaryType !== expectedSummaryType)) {
        return null;
    }

    const uploadStartTimeSeconds = parseUploadTimeSeconds(url, 'uploadStartTimeInSeconds');
    const uploadEndTimeSeconds = parseUploadTimeSeconds(url, 'uploadEndTimeInSeconds');
    const pullTokens = url.searchParams.getAll('token');
    if (uploadStartTimeSeconds === null
        || uploadEndTimeSeconds === null
        || uploadEndTimeSeconds < uploadStartTimeSeconds
        || uploadEndTimeSeconds - uploadStartTimeSeconds > GARMIN_HEALTH_API_MAX_UPLOAD_WINDOW_SECONDS
        || pullTokens.length !== 1
        || pullTokens[0].length === 0
        || pullTokens[0].length > 4096) {
        return null;
    }

    return {
        callbackURL: url.toString(),
        summaryType,
        uploadStartTimeMs: uploadStartTimeSeconds * 1000,
        uploadEndTimeMs: uploadEndTimeSeconds * 1000,
    };
}

export function normalizeTrustedGarminCallbackURL(
    callbackURL: string | null | undefined,
    expectedSummaryType?: GarminSupportedSummaryType,
): string | null {
    return parseTrustedGarminCallbackURL(callbackURL, expectedSummaryType)?.callbackURL || null;
}

export function assertTrustedGarminCallbackURL(
    callbackURL: string | null | undefined,
    expectedSummaryType?: GarminSupportedSummaryType,
): string {
    const trustedURL = normalizeTrustedGarminCallbackURL(callbackURL, expectedSummaryType);
    if (!trustedURL) {
        throw new InvalidGarminCallbackUrlError();
    }
    return trustedURL;
}
