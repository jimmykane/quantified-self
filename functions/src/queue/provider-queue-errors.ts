import { ServiceNames } from '@sports-alliance/sports-lib';

export class ProviderQueueUserNotConnectedError extends Error {
    public readonly name = 'ProviderQueueUserNotConnectedError';
    public readonly code = 'provider_user_not_connected';

    constructor(
        public readonly serviceName: ServiceNames,
        public readonly providerUserID: string,
        public readonly queueItemID: string,
    ) {
        super(`No local ${serviceName} token found for provider user ${providerUserID}; skipping queue item ${queueItemID}.`);
    }
}

export function isProviderQueueUserNotConnectedError(error: unknown): error is ProviderQueueUserNotConnectedError {
    return error instanceof ProviderQueueUserNotConnectedError
        || (typeof error === 'object'
            && error !== null
            && (error as { name?: unknown }).name === 'ProviderQueueUserNotConnectedError');
}
