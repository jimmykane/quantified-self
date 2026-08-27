import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isServiceUnavailableForSyncConnection } from '../../../shared/service-connection';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
  doesServiceDisconnectOperationPermitTokenUse,
  getServiceTokenRootDocumentRef,
} from '../service-token-store';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';
import {
  buildSuuntoHealthWebhookAccountBinding,
  doesSuuntoHealthWebhookBindingMatch,
  findSuuntoWebhookAccountBindingUserIDs,
  getSuuntoHealthWebhookAccountBindingRef,
  normalizeSuuntoTokenCredentialGeneration,
  parseSuuntoHealthWebhookAccountBinding,
  SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION,
} from './health-webhook-binding';

/**
 * Backfills the server-owned reverse binding for an existing active Suunto
 * connection. Each Firebase user has an independent binding so the same
 * provider account can fan out to every active staged connection.
 */
type SuuntoWebhookBindingStatus = 'created' | 'current' | 'conflict' | 'inactive';

async function evaluateSuuntoHealthWebhookAccountBinding(
  db: admin.firestore.Firestore,
  userID: string,
  providerUserId: string,
  nowMs: number,
  createOrRefreshBinding: boolean,
): Promise<SuuntoWebhookBindingStatus> {
  const bindingRef = getSuuntoHealthWebhookAccountBindingRef(db, providerUserId, userID);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, ServiceNames.SuuntoApp);
  const tokenRef = tokenRootRef.collection('tokens').doc(providerUserId);
  const serviceMetaRef = db.collection('users').doc(userID)
    .collection('meta').doc(ServiceNames.SuuntoApp);

  return db.runTransaction(async transaction => {
    const [bindingSnapshot, tokenSnapshot, tokenRootSnapshot, serviceMetaSnapshot, deletionGuard] =
      await Promise.all([
        transaction.get(bindingRef),
        transaction.get(tokenRef),
        transaction.get(tokenRootRef),
        transaction.get(serviceMetaRef),
        getUserDeletionGuardStateInTransaction(db, transaction, userID, nowMs),
      ]);
    const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
    const tokenRootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
    const serviceMeta = serviceMetaSnapshot.data() as Record<string, unknown> | undefined;
    const tokenCredentialGeneration = normalizeSuuntoTokenCredentialGeneration(
      tokenData?.tokenCredentialGeneration,
    );
    if (deletionGuard.shouldSkip
      || !tokenSnapshot.exists
      || !tokenRootSnapshot.exists
      || !serviceMetaSnapshot.exists
      || tokenData?.userName !== providerUserId
      || (tokenData.serviceName && tokenData.serviceName !== ServiceNames.SuuntoApp)
      || isServiceUnavailableForSyncConnection(serviceMeta)
      || isServiceDisconnectPendingData(tokenRootData)
      || !doesServiceDisconnectOperationPermitTokenUse(tokenRootData, undefined, nowMs)) {
      return 'inactive';
    }

    const current = parseSuuntoHealthWebhookAccountBinding(bindingSnapshot.data());
    if (bindingSnapshot.exists && !current) return 'conflict';
    if (current && current.userID !== userID) return 'conflict';
    if (current?.schemaVersion === SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION
      && doesSuuntoHealthWebhookBindingMatch(
        current,
        userID,
        providerUserId,
        tokenCredentialGeneration,
      )) {
      return 'current';
    }
    if (!createOrRefreshBinding) return 'inactive';
    transaction.set(
      bindingRef,
      buildSuuntoHealthWebhookAccountBinding(userID, providerUserId, tokenCredentialGeneration),
    );
    return 'created';
  });
}

export async function ensureSuuntoHealthWebhookAccountBindingForActiveToken(
  db: admin.firestore.Firestore,
  userID: string,
  providerUserId: string,
  nowMs = Date.now(),
): Promise<SuuntoWebhookBindingStatus> {
  return evaluateSuuntoHealthWebhookAccountBinding(
    db,
    userID,
    providerUserId,
    nowMs,
    true,
  );
}

/**
 * Resolves every currently authorized owner without creating new authority
 * from the client-readable token tree during webhook admission.
 */
export async function resolveActiveSuuntoWebhookUserIDs(
  db: admin.firestore.Firestore,
  providerUserId: string,
  candidateUserIDs: readonly string[] = [],
  nowMs = Date.now(),
): Promise<string[]> {
  const bindingUserIDs = await findSuuntoWebhookAccountBindingUserIDs(
    db,
    providerUserId,
    candidateUserIDs,
  );
  const statuses = await Promise.all(bindingUserIDs.map(async userID => ({
    userID,
    status: await evaluateSuuntoHealthWebhookAccountBinding(
      db,
      userID,
      providerUserId,
      nowMs,
      false,
    ),
  })));
  return statuses
    .filter(({ status }) => status === 'current')
    .map(({ userID }) => userID);
}
