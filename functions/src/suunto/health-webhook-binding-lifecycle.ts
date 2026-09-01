import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  isServiceUnavailableForSyncConnection,
  SERVICE_CONNECTION_STATES,
} from '../../../shared/service-connection';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
  doesServiceDisconnectOperationPermitTokenUse,
  getServiceTokenRootDocumentRef,
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD,
} from '../service-token-store';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';
import { getTokenData } from '../tokens';
import {
  ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
  areTokenCredentialSnapshotsEqual,
  getTokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import type { SleepLifecycleWriterDependencies } from '../sleep/writer';
import {
  buildSuuntoHealthWebhookAccountBinding,
  doesSuuntoHealthWebhookBindingMatch,
  findSuuntoWebhookAccountBindingUserIDs,
  getSuuntoHealthWebhookAccountBindingRef,
  normalizeSuuntoTokenCredentialGeneration,
  parseSuuntoHealthWebhookAccountBinding,
  SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION,
  SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES,
  type SuuntoWebhookBindingAuthorizationSource,
} from './health-webhook-binding';
import { SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH } from './health';

/**
 * Each Firebase user has an independent binding so the same provider account
 * can fan out to every active connection. A local token document is not
 * sufficient authority to create one: legacy candidates must first prove the
 * account identity through a forced provider refresh.
 */
export type SuuntoWebhookBindingStatus = 'created' | 'current' | 'unverified' | 'inactive';
export const SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_VERSION = 1;
export const SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS = {
  Version: 'suuntoLegacyWebhookBindingRepairVersion',
  RepairedAtMs: 'suuntoLegacyWebhookBindingRepairedAtMs',
  IncidentStartMs: 'suuntoLegacyWebhookBindingRepairIncidentStartMs',
} as const;
export type SuuntoWebhookWriteLifecycleGuards = Required<Pick<
  SleepLifecycleWriterDependencies,
  | 'requiredExistingDocumentRef'
  | 'requiredExistingTokenCredential'
  | 'requiredDocumentFieldValues'
  | 'additionalRequiredDocumentFieldValues'
>>;

function expectedFieldsEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => Object.is(left[key], right[key]));
}

const MAX_SUUNTO_LIFECYCLE_GENERATION_LENGTH = 128;

interface ParsedLifecycleGeneration {
  kind: 'missing' | 'valid' | 'malformed';
  value: string | null;
}

function parseLifecycleGeneration(value: unknown): ParsedLifecycleGeneration {
  if (value === undefined || value === null) {
    return { kind: 'missing', value: null };
  }
  if (typeof value !== 'string') {
    return { kind: 'malformed', value: null };
  }
  const normalized = value.trim();
  return normalized
    && normalized === value
    && normalized.length <= MAX_SUUNTO_LIFECYCLE_GENERATION_LENGTH
    ? { kind: 'valid', value: normalized }
    : { kind: 'malformed', value: null };
}

/**
 * Token refresh may rotate credential fields but must not change the binding,
 * account generation, token-root lifecycle, or service connection captured
 * before provider work began.
 */
export function areSuuntoWebhookWriteLifecycleGuardsContinuous(
  initial: SuuntoWebhookWriteLifecycleGuards,
  current: SuuntoWebhookWriteLifecycleGuards,
): boolean {
  const initialAuthorities = [
    initial.requiredDocumentFieldValues,
    ...initial.additionalRequiredDocumentFieldValues,
  ];
  const currentAuthorities = [
    current.requiredDocumentFieldValues,
    ...current.additionalRequiredDocumentFieldValues,
  ];
  return initialAuthorities.length === currentAuthorities.length
    && initialAuthorities.every((guard, index) => {
      const currentGuard = currentAuthorities[index];
      return currentGuard?.documentRef.path === guard.documentRef.path
        && expectedFieldsEqual(guard.expectedFields, currentGuard.expectedFields);
    });
}

function authorityDigestValue(value: unknown): unknown {
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null' };
  return { type: typeof value, value };
}

/**
 * Opaque, stable admission fence for queued webhook payloads. Exact rotating
 * credential fields are deliberately excluded; every binding, account,
 * disconnect, root-OAuth, and connection field remains covered.
 */
export function getSuuntoWebhookWriteLifecycleAuthorityDigest(
  guards: SuuntoWebhookWriteLifecycleGuards,
): string {
  const authorities = [
    guards.requiredDocumentFieldValues,
    ...guards.additionalRequiredDocumentFieldValues,
  ].map(guard => ({
    documentPath: guard.documentRef.path,
    expectedFields: Object.keys(guard.expectedFields)
      .sort()
      .map(fieldName => [
        fieldName,
        authorityDigestValue(guard.expectedFields[fieldName]),
      ]),
  }));
  return crypto.createHash('sha256')
    .update(JSON.stringify(authorities))
    .digest('hex');
}

async function evaluateSuuntoHealthWebhookAccountBinding(
  db: admin.firestore.Firestore,
  userID: string,
  providerUserId: string,
  nowMs: number,
  options: {
    authorizationSource?: SuuntoWebhookBindingAuthorizationSource;
    expectedTokenCredential?: ReturnType<typeof getTokenCredentialSnapshot>;
    verifiedTokenPatch?: Record<string, unknown>;
    requireExistingConnectedServiceMeta?: boolean;
    allowLifecycleMigration?: boolean;
  } = {},
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
    const tokenCredentialGeneration = parseLifecycleGeneration(
      tokenData?.tokenCredentialGeneration,
    );
    const rootOAuthCredentialGeneration = parseLifecycleGeneration(
      tokenRootData?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
    );
    const connectionStateGeneration = parseLifecycleGeneration(
      serviceMeta?.connectionStateGeneration,
    );
    if (deletionGuard.shouldSkip
      || !tokenSnapshot.exists
      || tokenData?.userName !== providerUserId
      || (tokenData.serviceName && tokenData.serviceName !== ServiceNames.SuuntoApp)
      || (options.expectedTokenCredential
        && !areTokenCredentialSnapshotsEqual(
          getTokenCredentialSnapshot(tokenData),
          options.expectedTokenCredential,
        ))
      || (options.requireExistingConnectedServiceMeta
        && (!serviceMetaSnapshot.exists
          || serviceMeta?.connectionState !== SERVICE_CONNECTION_STATES.Connected))
      || isServiceUnavailableForSyncConnection(serviceMeta)
      || (serviceMeta?.connectionState !== undefined
        && serviceMeta?.connectionState !== null
        && serviceMeta.connectionState !== SERVICE_CONNECTION_STATES.Connected)
      || isServiceDisconnectPendingData(tokenRootData)
      || !doesServiceDisconnectOperationPermitTokenUse(tokenRootData, undefined, nowMs)) {
      return 'inactive';
    }

    if (tokenCredentialGeneration.kind === 'malformed'
      || rootOAuthCredentialGeneration.kind === 'malformed'
      || connectionStateGeneration.kind === 'malformed') {
      return 'inactive';
    }

    const current = parseSuuntoHealthWebhookAccountBinding(bindingSnapshot.data());
    const hasCurrentAuthorizedBinding = current?.schemaVersion
      === SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION
      && doesSuuntoHealthWebhookBindingMatch(
        current,
        userID,
        providerUserId,
        tokenCredentialGeneration.value,
      );
    const requiresIndependentProviderVerification = tokenCredentialGeneration.kind === 'valid'
      && rootOAuthCredentialGeneration.kind === 'missing';
    const canMigrateLegacyLifecycle = Boolean(options.authorizationSource)
      || (hasCurrentAuthorizedBinding && !requiresIndependentProviderVerification);
    const requiresLifecycleMigration = !serviceMetaSnapshot.exists
      || !tokenRootSnapshot.exists
      || serviceMeta?.connectionState !== SERVICE_CONNECTION_STATES.Connected
      || tokenCredentialGeneration.kind === 'missing'
      || rootOAuthCredentialGeneration.kind === 'missing'
      || connectionStateGeneration.kind === 'missing';

    if (requiresLifecycleMigration
      && (!canMigrateLegacyLifecycle || options.allowLifecycleMigration === false)) {
      return 'unverified';
    }

    const nextTokenCredentialGeneration = tokenCredentialGeneration.value || crypto.randomUUID();
    const nextRootOAuthCredentialGeneration = rootOAuthCredentialGeneration.value || crypto.randomUUID();
    const nextConnectionStateGeneration = connectionStateGeneration.value || crypto.randomUUID();
    const bindingAuthorizationSource = current?.authorizationSource || options.authorizationSource;
    if (!bindingAuthorizationSource) return 'unverified';

    if (requiresLifecycleMigration) {
      if (tokenCredentialGeneration.kind === 'missing') {
        transaction.set(tokenRef, {
          tokenCredentialGeneration: nextTokenCredentialGeneration,
        }, { merge: true });
      }
      if (rootOAuthCredentialGeneration.kind === 'missing') {
        transaction.set(tokenRootRef, {
          [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: nextRootOAuthCredentialGeneration,
        }, { merge: true });
      }
      if (!serviceMetaSnapshot.exists
        || serviceMeta?.connectionState !== SERVICE_CONNECTION_STATES.Connected
        || connectionStateGeneration.kind === 'missing') {
        transaction.set(serviceMetaRef, {
          connectionState: SERVICE_CONNECTION_STATES.Connected,
          connectionStateGeneration: nextConnectionStateGeneration,
        }, { merge: true });
      }
    }

    if (options.verifiedTokenPatch) {
      transaction.set(tokenRef, options.verifiedTokenPatch, { merge: true });
    }
    if (hasCurrentAuthorizedBinding
      && current.tokenCredentialGeneration === nextTokenCredentialGeneration) {
      return 'current';
    }
    transaction.set(
      bindingRef,
      buildSuuntoHealthWebhookAccountBinding(
        userID,
        providerUserId,
        nextTokenCredentialGeneration,
        bindingAuthorizationSource,
      ),
    );
    return hasCurrentAuthorizedBinding ? 'current' : 'created';
  });
}

async function ensureSuuntoWebhookAccountBindingForProviderVerifiedTokenInternal(
  db: admin.firestore.Firestore,
  userID: string,
  tokenSnapshot: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
  nowMs: number,
  options: {
    forceProviderVerification?: boolean;
    verifiedTokenPatch?: Record<string, unknown>;
    requireExistingConnectedServiceMeta?: boolean;
  } = {},
): Promise<SuuntoWebhookBindingStatus> {
  const providerUserId = tokenSnapshot.id.trim();
  const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
  if (!providerUserId
    || providerUserId !== tokenSnapshot.id
    || providerUserId.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH
    || tokenData?.userName !== providerUserId
    || tokenData.serviceName !== ServiceNames.SuuntoApp) {
    return 'unverified';
  }

  const existingStatus = await evaluateSuuntoHealthWebhookAccountBinding(
    db,
    userID,
    providerUserId,
    nowMs,
    {
      requireExistingConnectedServiceMeta:
        options.requireExistingConnectedServiceMeta === true,
      // A forced repair must not create any lifecycle authority before the
      // provider identity is independently verified. The final credential-
      // fenced transaction performs all migration writes atomically.
      allowLifecycleMigration: options.forceProviderVerification !== true,
    },
  );
  if (existingStatus === 'inactive'
    || (existingStatus === 'current' && !options.forceProviderVerification)) {
    return existingStatus;
  }

  const refreshedToken = await getTokenData(
    tokenSnapshot,
    ServiceNames.SuuntoApp,
    true,
    {
      opaqueTelemetry: true,
      // Provider verification must not fall back to a newer local snapshot:
      // only this forced refresh response proves the account identity.
      allowSupersededSnapshotRetry: false,
    },
  );
  if (typeof refreshedToken.userName !== 'string'
    || refreshedToken.userName !== providerUserId) {
    return 'unverified';
  }

  // The refresh coordinator persists rotating credentials before this
  // lifecycle transaction. Re-read that exact result and require it to remain
  // unchanged while the missing root/generations/binding are created. A
  // concurrent reconnect or disconnect therefore wins instead of letting an
  // older provider proof authorize a replacement credential.
  const refreshedTokenSnapshot = await tokenSnapshot.ref.get();
  const refreshedTokenData = refreshedTokenSnapshot.data() as Record<string, unknown> | undefined;
  if (!refreshedTokenSnapshot.exists
    || refreshedTokenSnapshot.id !== providerUserId
    || refreshedTokenData?.userName !== providerUserId
    || refreshedTokenData.serviceName !== ServiceNames.SuuntoApp) {
    return 'unverified';
  }

  return evaluateSuuntoHealthWebhookAccountBinding(
    db,
    userID,
    providerUserId,
    nowMs,
    {
      authorizationSource: SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES.ProviderRefresh,
      expectedTokenCredential: getTokenCredentialSnapshot(refreshedTokenData),
      verifiedTokenPatch: options.verifiedTokenPatch,
      requireExistingConnectedServiceMeta:
        options.requireExistingConnectedServiceMeta === true,
    },
  );
}

export function ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
  db: admin.firestore.Firestore,
  userID: string,
  tokenSnapshot: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
  nowMs = Date.now(),
): Promise<SuuntoWebhookBindingStatus> {
  return ensureSuuntoWebhookAccountBindingForProviderVerifiedTokenInternal(
    db,
    userID,
    tokenSnapshot,
    nowMs,
  );
}

/**
 * One-time child-only legacy repair. The provider refresh, exact credential
 * fence, lifecycle creation, binding creation, and resumable repair marker are
 * one authorization decision. A partial write cannot make the connection look
 * repaired while leaving the binding or its lifecycle incomplete (or vice
 * versa).
 */
export function repairSuuntoLegacyWebhookBindingForProviderVerifiedToken(
  db: admin.firestore.Firestore,
  userID: string,
  tokenSnapshot: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
  incidentStartMs: number,
  nowMs = Date.now(),
): Promise<SuuntoWebhookBindingStatus> {
  if (!Number.isFinite(incidentStartMs) || incidentStartMs <= 0) {
    return Promise.resolve('unverified');
  }
  return ensureSuuntoWebhookAccountBindingForProviderVerifiedTokenInternal(
    db,
    userID,
    tokenSnapshot,
    nowMs,
    {
      forceProviderVerification: true,
      requireExistingConnectedServiceMeta: true,
      verifiedTokenPatch: {
        [SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS.Version]:
          SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_VERSION,
        [SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS.RepairedAtMs]: nowMs,
        [SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS.IncidentStartMs]: incidentStartMs,
      },
    },
  );
}

/**
 * Captures the exact binding, credential, root, and connection fields that a
 * Sleep webhook write must still match inside its Firestore transaction.
 */
export async function captureActiveSuuntoWebhookWriteLifecycleGuards(
  db: admin.firestore.Firestore,
  userID: string,
  providerUserId: string,
  tokenSnapshot: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
  nowMs = Date.now(),
): Promise<SuuntoWebhookWriteLifecycleGuards | null> {
  if (!providerUserId
    || providerUserId !== providerUserId.trim()
    || providerUserId !== tokenSnapshot.id
    || providerUserId.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
    return null;
  }
  const expectedCredential = getTokenCredentialSnapshot(
    tokenSnapshot.data() as Record<string, unknown> | undefined,
  );
  return captureSuuntoWebhookWriteLifecycleGuards(
    db,
    userID,
    providerUserId,
    nowMs,
    expectedCredential,
  );
}

/**
 * Atomically rebases rotating credential fields onto the current authorized
 * account. Callers must still compare the immutable authority fields with
 * their pre-I/O guards before accepting this rebased write fence.
 */
export async function captureCurrentSuuntoWebhookWriteLifecycleGuards(
  db: admin.firestore.Firestore,
  userID: string,
  providerUserId: string,
  nowMs = Date.now(),
): Promise<SuuntoWebhookWriteLifecycleGuards | null> {
  if (!providerUserId
    || providerUserId !== providerUserId.trim()
    || providerUserId.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
    return null;
  }
  return captureSuuntoWebhookWriteLifecycleGuards(
    db,
    userID,
    providerUserId,
    nowMs,
  );
}

async function captureSuuntoWebhookWriteLifecycleGuards(
  db: admin.firestore.Firestore,
  userID: string,
  providerUserId: string,
  nowMs: number,
  expectedCredential?: ReturnType<typeof getTokenCredentialSnapshot>,
): Promise<SuuntoWebhookWriteLifecycleGuards | null> {
  const bindingRef = getSuuntoHealthWebhookAccountBindingRef(db, providerUserId, userID);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, ServiceNames.SuuntoApp);
  const tokenRef = tokenRootRef.collection('tokens').doc(providerUserId);
  const serviceMetaRef = db.collection('users').doc(userID)
    .collection('meta').doc(ServiceNames.SuuntoApp);

  return db.runTransaction(async transaction => {
    const [bindingSnapshot, liveTokenSnapshot, tokenRootSnapshot, serviceMetaSnapshot, deletionGuard] =
      await Promise.all([
        transaction.get(bindingRef),
        transaction.get(tokenRef),
        transaction.get(tokenRootRef),
        transaction.get(serviceMetaRef),
        getUserDeletionGuardStateInTransaction(db, transaction, userID, nowMs),
      ]);
    const binding = parseSuuntoHealthWebhookAccountBinding(bindingSnapshot.data());
    const tokenData = liveTokenSnapshot.data() as Record<string, unknown> | undefined;
    const tokenRootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
    const serviceMeta = serviceMetaSnapshot.data() as Record<string, unknown> | undefined;
    const liveCredential = getTokenCredentialSnapshot(tokenData);
    if (deletionGuard.shouldSkip
      || !bindingSnapshot.exists
      || !liveTokenSnapshot.exists
      || !tokenRootSnapshot.exists
      || !serviceMetaSnapshot.exists
      || tokenData?.userName !== providerUserId
      || tokenData?.serviceName !== ServiceNames.SuuntoApp
      || (expectedCredential
        && !areTokenCredentialSnapshotsEqual(liveCredential, expectedCredential))
      || !doesSuuntoHealthWebhookBindingMatch(
        binding,
        userID,
        providerUserId,
        normalizeSuuntoTokenCredentialGeneration(tokenData?.tokenCredentialGeneration),
      )
      || isServiceUnavailableForSyncConnection(serviceMeta)
      || isServiceDisconnectPendingData(tokenRootData)
      || !doesServiceDisconnectOperationPermitTokenUse(tokenRootData, undefined, nowMs)) {
      return null;
    }

    return {
      requiredExistingDocumentRef: tokenRef,
      requiredExistingTokenCredential: liveCredential,
      requiredDocumentFieldValues: {
        documentRef: bindingRef,
        expectedFields: {
          schemaVersion: binding?.schemaVersion,
          authorizationSource: binding?.authorizationSource,
          userID: binding?.userID,
          providerAccountDigest: binding?.providerAccountDigest,
          tokenCredentialGeneration: binding?.tokenCredentialGeneration,
        },
      },
      additionalRequiredDocumentFieldValues: [{
        documentRef: tokenRef,
        expectedFields: {
          userName: tokenData.userName,
          serviceName: tokenData.serviceName,
          tokenCredentialGeneration: tokenData.tokenCredentialGeneration,
        },
      }, {
        documentRef: tokenRootRef,
        expectedFields: {
          [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]:
            tokenRootData?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
          disconnectState: tokenRootData?.disconnectState,
          [SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]:
            tokenRootData?.[SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD],
        },
      }, {
        documentRef: serviceMetaRef,
        expectedFields: {
          connectionState: serviceMeta?.connectionState,
          connectionStateGeneration: serviceMeta?.connectionStateGeneration,
        },
      }],
    };
  });
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
    ),
  })));
  return statuses
    .filter(({ status }) => status === 'current')
    .map(({ userID }) => userID);
}
