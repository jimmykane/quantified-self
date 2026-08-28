const SUUNTO_PROVIDER_USER_ID_MAX_LENGTH = 512;
const SUUNTO_ACCESS_TOKEN_MAX_LENGTH = 64 * 1024;

export class SuuntoTokenIdentityError extends Error {
    public readonly name = 'SuuntoTokenIdentityError';
    public readonly code = 'suunto_token_identity_invalid';

    constructor() {
        super('Suunto returned inconsistent account identity data.');
    }
}

function normalizeProviderUserId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized
        && normalized === value
        && normalized.length <= SUUNTO_PROVIDER_USER_ID_MAX_LENGTH
        ? normalized
        : null;
}

function providerUserIdFromAccessToken(value: unknown): string | null {
    if (typeof value !== 'string'
        || value.length === 0
        || value.length > SUUNTO_ACCESS_TOKEN_MAX_LENGTH) {
        return null;
    }
    const segments = value.split('.');
    if (segments.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(segments[1])) {
        return null;
    }

    try {
        const payload = JSON.parse(
            Buffer.from(segments[1], 'base64url').toString('utf8'),
        ) as unknown;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return null;
        }
        return normalizeProviderUserId((payload as Record<string, unknown>).user);
    } catch {
        return null;
    }
}

/**
 * Resolve identity only from a token response returned directly by Suunto's
 * authenticated OAuth exchange. Suunto documents `user` as a custom claim in
 * the access-token JWT; older responses may also expose the same value as a
 * top-level token field. A disagreement is never persisted or used to mint
 * webhook authority.
 */
export function resolveSuuntoProviderUserIdFromTokenResponse(
    tokenResponse: Record<string, unknown>,
    expectedProviderUserId?: string | null,
): string {
    const rawProviderUserId = normalizeProviderUserId(tokenResponse.user);
    const claimProviderUserId = providerUserIdFromAccessToken(tokenResponse.access_token);
    if (rawProviderUserId && claimProviderUserId
        && rawProviderUserId !== claimProviderUserId) {
        throw new SuuntoTokenIdentityError();
    }

    const providerUserId = rawProviderUserId || claimProviderUserId;
    const expected = expectedProviderUserId === undefined || expectedProviderUserId === null
        ? null
        : normalizeProviderUserId(expectedProviderUserId);
    if (!providerUserId
        || (expectedProviderUserId !== undefined && expectedProviderUserId !== null && !expected)
        || (expected && providerUserId !== expected)) {
        throw new SuuntoTokenIdentityError();
    }
    return providerUserId;
}
