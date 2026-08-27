import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceAdapter } from './auth/factory';
import {
  getSuuntoHealthWebhookAccountBindingRef,
  parseSuuntoHealthWebhookAccountBinding,
} from './suunto/health-webhook-binding';

export const OAUTH_FLOW_GENERATION_FIELD = 'oauthFlowGeneration';
export const SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD = 'disconnectOperationGeneration';
export const SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD = 'disconnectOperationLeaseExpiresAt';

/**
 * Explicit disconnects fence OAuth and token use while provider cleanup is in
 * flight. The lease deliberately exceeds callable execution time, but still
 * expires so a crashed invocation cannot strand the connection forever.
 */
export const EXPLICIT_DISCONNECT_OPERATION_LEASE_MS = 10 * 60 * 1000;

function normalizeGeneration(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLeaseExpiry(value: unknown): number {
  const expiresAt = Number(value);
  return Number.isFinite(expiresAt) ? expiresAt : 0;
}

export function getServiceDisconnectOperationGeneration(
  data: object | null | undefined,
): string | null {
  const rootData = data as Record<string, unknown> | null | undefined;
  return normalizeGeneration(rootData?.[SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]) || null;
}

export function getActiveServiceDisconnectOperationGeneration(
  data: object | null | undefined,
  nowMs = Date.now(),
): string | null {
  const rootData = data as Record<string, unknown> | null | undefined;
  const generation = getServiceDisconnectOperationGeneration(rootData);
  const expiresAt = normalizeLeaseExpiry(rootData?.[SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD]);
  return generation && expiresAt > nowMs ? generation : null;
}

/**
 * A normal worker may proceed only after the explicit-disconnect fence has
 * been explicitly recovered or finished. An expired fence may be reclaimed
 * by OAuth or a disconnect retry, but must not silently resume sync after a
 * user-initiated disconnect.
 * The explicit-disconnect owner may proceed only while its own lease remains
 * current, so an expired owner cannot resume after a recovery has started.
 */
export function doesServiceDisconnectOperationPermitTokenUse(
  data: object | null | undefined,
  expectedGeneration: string | undefined,
  nowMs = Date.now(),
): boolean {
  const expected = normalizeGeneration(expectedGeneration);
  if (!expected) return getServiceDisconnectOperationGeneration(data) === null;
  return getActiveServiceDisconnectOperationGeneration(data, nowMs) === expected;
}

function hasPendingOAuthFlowContext(snapshot: admin.firestore.DocumentSnapshot): boolean {
  if (!snapshot.exists) {
    return false;
  }

  const data = snapshot.data() as Record<string, unknown> | undefined;
  const state = typeof data?.state === 'string' ? data.state.trim() : '';
  const codeVerifier = typeof data?.codeVerifier === 'string' ? data.codeVerifier.trim() : '';
  const oauthFlowGeneration = typeof data?.[OAUTH_FLOW_GENERATION_FIELD] === 'string'
    ? data[OAUTH_FLOW_GENERATION_FIELD].trim()
    : '';
  return state.length > 0 || codeVerifier.length > 0 || oauthFlowGeneration.length > 0;
}

export interface DeleteLocalServiceTokenOptions {
  preserveOAuthFlowContext?: boolean;
  /** Keep an empty root so a later guarded lifecycle transaction can still verify its generation. */
  preserveTokenRootWhenEmpty?: boolean;
  shouldDeleteInTransaction?: (transaction: admin.firestore.Transaction) => Promise<boolean>;
}

export function getServiceTokenRootDocumentRef(
  userID: string,
  serviceName: ServiceNames,
): admin.firestore.DocumentReference {
  const adapter = getServiceAdapter(serviceName);
  return admin.firestore().collection(adapter.tokenCollectionName).doc(userID);
}

export function getServiceTokenCollectionRef(
  userID: string,
  serviceName: ServiceNames,
): admin.firestore.CollectionReference {
  return getServiceTokenRootDocumentRef(userID, serviceName).collection('tokens');
}

export interface DeleteLocalServiceTokenResult {
  tokenRootDeleted: boolean;
  tokenRootPreservedForOAuthFlow: boolean;
  remainingTokenCount: number;
  skippedByCondition: boolean;
}

export async function deleteLocalServiceToken(
  userID: string,
  serviceName: ServiceNames,
  tokenID: string,
  options: DeleteLocalServiceTokenOptions = {},
): Promise<DeleteLocalServiceTokenResult> {
  logger.info(`Starting delete for local token ${tokenID} for ${userID} and serviceName ${serviceName}`);

  const userDocRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const tokenCollectionRef = userDocRef.collection('tokens');
  const tokenDocRef = tokenCollectionRef.doc(tokenID);

  return admin.firestore().runTransaction(async (transaction) => {
    if (options.shouldDeleteInTransaction && !(await options.shouldDeleteInTransaction(transaction))) {
      return {
        tokenRootDeleted: false,
        tokenRootPreservedForOAuthFlow: false,
        remainingTokenCount: 0,
        skippedByCondition: true,
      };
    }

    const tokenRootSnapshot = await transaction.get(userDocRef);
    const tokenQuerySnapshot = await transaction.get(tokenCollectionRef);
    const suuntoProviderUserId = serviceName === ServiceNames.SuuntoApp
      ? tokenID.trim()
      : '';
    const suuntoBindingRef = suuntoProviderUserId
      ? getSuuntoHealthWebhookAccountBindingRef(
        admin.firestore(),
        suuntoProviderUserId,
        userID,
      )
      : null;
    const suuntoBindingSnapshot = suuntoBindingRef
      ? await transaction.get(suuntoBindingRef)
      : null;
    const remainingTokenCount = tokenQuerySnapshot.docs.filter((doc) => doc.id !== tokenID).length;
    const shouldPreserveOAuthFlowContext = options.preserveOAuthFlowContext !== false;
    const tokenRootPreservedForOAuthFlow = shouldPreserveOAuthFlowContext
      && remainingTokenCount === 0
      && hasPendingOAuthFlowContext(tokenRootSnapshot);

    transaction.delete(tokenDocRef);
    if (suuntoBindingRef
      && parseSuuntoHealthWebhookAccountBinding(suuntoBindingSnapshot?.data())?.userID === userID) {
      transaction.delete(suuntoBindingRef);
    }

    if (remainingTokenCount === 0
      && !tokenRootPreservedForOAuthFlow
      && options.preserveTokenRootWhenEmpty !== true) {
      // Service token roots only store root fields plus the `tokens` subcollection.
      // After deleting the final token doc in this transaction, no descendants remain on the root.
      transaction.delete(userDocRef);
    }

    logger.info(`Remaining tokens for ${userID}: ${remainingTokenCount}`);
    if (tokenRootPreservedForOAuthFlow) {
      logger.info(`Preserving ${serviceName} token root for ${userID} because an OAuth reconnect flow is already in progress.`);
    }

    return {
      tokenRootDeleted: remainingTokenCount === 0
        && !tokenRootPreservedForOAuthFlow
        && options.preserveTokenRootWhenEmpty !== true,
      tokenRootPreservedForOAuthFlow,
      remainingTokenCount,
      skippedByCondition: false,
    };
  });
}
