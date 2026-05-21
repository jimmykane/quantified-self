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

export class ProviderQueueUserDeletedOrDeletingError extends Error {
    public readonly name = 'ProviderQueueUserDeletedOrDeletingError';
    public readonly code = 'provider_user_deleted_or_deleting';

    constructor(
        public readonly serviceName: ServiceNames,
        public readonly firebaseUserID: string,
        public readonly providerUserID: string,
        public readonly queueItemID: string,
    ) {
        super(`User ${firebaseUserID} is missing or deletion is in progress; skipping ${serviceName} queue item ${queueItemID} for provider user ${providerUserID}.`);
    }
}

export function isProviderQueueUserNotConnectedError(error: unknown): error is ProviderQueueUserNotConnectedError {
    return error instanceof ProviderQueueUserNotConnectedError
        || (typeof error === 'object'
            && error !== null
            && (error as { name?: unknown }).name === 'ProviderQueueUserNotConnectedError');
}

export function isProviderQueueUserDeletedOrDeletingError(error: unknown): error is ProviderQueueUserDeletedOrDeletingError {
    return error instanceof ProviderQueueUserDeletedOrDeletingError
        || (typeof error === 'object'
            && error !== null
            && (error as { name?: unknown }).name === 'ProviderQueueUserDeletedOrDeletingError');
}

export function isProviderQueueSkippedWithoutRetryError(error: unknown): error is ProviderQueueUserNotConnectedError | ProviderQueueUserDeletedOrDeletingError {
    return isProviderQueueUserNotConnectedError(error)
        || isProviderQueueUserDeletedOrDeletingError(error);
}
