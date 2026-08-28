import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    isDisconnectPendingServiceConnection,
    SERVICE_CONNECTION_STATES,
} from '../../../shared/service-connection';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD } from '../token-refresh-coordinator';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';
import { getServiceDisconnectOperationGeneration } from '../service-token-store';

const MAX_LIFECYCLE_GENERATION_LENGTH = 128;

export interface RouteDeliverySourceLifecycleFence {
    connectionStateGeneration: string;
    tokenCredentialGeneration: string;
    rootOAuthCredentialGeneration: string;
}

interface RouteDeliverySourceLifecycleFenceInput {
    connectionStateGeneration?: unknown;
    tokenCredentialGeneration?: unknown;
    rootOAuthCredentialGeneration?: unknown;
}

export type RouteDeliverySourceLifecycleStatus = 'active' | 'disconnect_pending' | 'inactive';

export interface RouteDeliverySourceLifecycleResult {
    status: RouteDeliverySourceLifecycleStatus;
    fence?: RouteDeliverySourceLifecycleFence;
}

interface FirestoreDocumentReader {
    get(ref: admin.firestore.DocumentReference): Promise<admin.firestore.DocumentSnapshot>;
}

function normalizeGeneration(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized
        && normalized === value
        && normalized.length <= MAX_LIFECYCLE_GENERATION_LENGTH
        ? normalized
        : null;
}

export function parseRouteDeliverySourceLifecycleFence(
    value: RouteDeliverySourceLifecycleFenceInput | null | undefined,
): RouteDeliverySourceLifecycleFence | null {
    const connectionStateGeneration = normalizeGeneration(value?.connectionStateGeneration);
    const tokenCredentialGeneration = normalizeGeneration(value?.tokenCredentialGeneration);
    const rootOAuthCredentialGeneration = normalizeGeneration(value?.rootOAuthCredentialGeneration);
    return connectionStateGeneration && tokenCredentialGeneration && rootOAuthCredentialGeneration
        ? {
            connectionStateGeneration,
            tokenCredentialGeneration,
            rootOAuthCredentialGeneration,
        }
        : null;
}

function fencesEqual(
    left: RouteDeliverySourceLifecycleFence,
    right: RouteDeliverySourceLifecycleFence,
): boolean {
    return left.connectionStateGeneration === right.connectionStateGeneration
        && left.tokenCredentialGeneration === right.tokenCredentialGeneration
        && left.rootOAuthCredentialGeneration === right.rootOAuthCredentialGeneration;
}

async function readSuuntoSourceLifecycle(
    db: admin.firestore.Firestore,
    reader: FirestoreDocumentReader,
    userID: string,
    providerUserId: string,
    expectedFence?: RouteDeliverySourceLifecycleFence,
): Promise<RouteDeliverySourceLifecycleResult> {
    const metaRef = db.collection('users').doc(userID).collection('meta').doc(ServiceNames.SuuntoApp);
    const tokenRootRef = db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(userID);
    const tokenRef = tokenRootRef.collection('tokens').doc(providerUserId);
    const [metaSnapshot, tokenRootSnapshot, tokenSnapshot] = await Promise.all([
        reader.get(metaRef),
        reader.get(tokenRootRef),
        reader.get(tokenRef),
    ]);
    const meta = metaSnapshot.data() as Record<string, unknown> | undefined;
    const tokenRoot = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
    const token = tokenSnapshot.data() as Record<string, unknown> | undefined;

    if (isDisconnectPendingServiceConnection(meta)
        || isServiceDisconnectPendingData(tokenRoot)
        || getServiceDisconnectOperationGeneration(tokenRoot) !== null) {
        return { status: 'disconnect_pending' };
    }

    const fence = parseRouteDeliverySourceLifecycleFence({
        connectionStateGeneration: meta?.connectionStateGeneration,
        tokenCredentialGeneration: token?.tokenCredentialGeneration,
        rootOAuthCredentialGeneration: tokenRoot?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
    });
    if (!metaSnapshot.exists
        || !tokenRootSnapshot.exists
        || !tokenSnapshot.exists
        || meta?.connectionState !== SERVICE_CONNECTION_STATES.Connected
        || token?.serviceName !== ServiceNames.SuuntoApp
        || token?.userName !== providerUserId
        || !fence
        || (expectedFence && !fencesEqual(fence, expectedFence))) {
        return { status: 'inactive' };
    }

    return { status: 'active', fence };
}

export function captureCurrentSuuntoRouteDeliverySourceLifecycle(
    db: admin.firestore.Firestore,
    userID: string,
    providerUserId: string,
): Promise<RouteDeliverySourceLifecycleResult> {
    return readSuuntoSourceLifecycle(
        db,
        { get: ref => ref.get() },
        userID,
        providerUserId,
    );
}

export function recheckCurrentSuuntoRouteDeliverySourceLifecycle(
    db: admin.firestore.Firestore,
    userID: string,
    providerUserId: string,
    expectedFence: RouteDeliverySourceLifecycleFence,
): Promise<RouteDeliverySourceLifecycleResult> {
    return readSuuntoSourceLifecycle(
        db,
        { get: ref => ref.get() },
        userID,
        providerUserId,
        expectedFence,
    );
}

export function recheckSuuntoRouteDeliverySourceLifecycleInTransaction(
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    userID: string,
    providerUserId: string,
    expectedFence: RouteDeliverySourceLifecycleFence,
): Promise<RouteDeliverySourceLifecycleResult> {
    return readSuuntoSourceLifecycle(
        db,
        { get: ref => transaction.get(ref) },
        userID,
        providerUserId,
        expectedFence,
    );
}
