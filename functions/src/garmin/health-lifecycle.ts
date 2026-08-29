import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SERVICE_CONNECTION_STATES } from '../../../shared/service-connection';
import {
  HealthLifecycleDocumentFieldGuard,
  HealthWriterDependencies,
} from '../health/writer';
import { getServiceConnectionMeta } from '../service-connection-meta';
import { getServiceTokenRootDocumentRef } from '../service-token-store';
import {
  ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
  areTokenCredentialSnapshotsEqual,
  doesOAuthCredentialGenerationAuthorizeToken,
  getTokenCredentialSnapshot,
  TokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';

type TokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;

export class GarminHealthAccountValidationError extends Error {
  public readonly name = 'GarminHealthAccountValidationError';
  public readonly code = 'garmin_health_account_invalid';

  constructor() {
    super('Garmin Health account validation failed.');
  }
}

export interface GarminHealthWriteLifecycleGuards extends HealthWriterDependencies {
  requiredExistingDocumentRef: admin.firestore.DocumentReference;
  requiredExistingTokenCredential: TokenCredentialSnapshot;
  providerUserId: string;
  providerIdentityPinned: boolean;
  tokenCredentialGeneration: string | null;
  rootOAuthCredentialGeneration: string | null;
  connectionStateGeneration: string | null;
}

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function expectedGenerationField(value: string | null): string | undefined {
  return value || undefined;
}

export async function captureActiveGarminHealthWriteLifecycleGuards(
  db: admin.firestore.Firestore,
  firebaseUserID: string,
  providerUserId: string,
  tokenSnapshot: TokenSnapshot,
): Promise<GarminHealthWriteLifecycleGuards | null> {
  const normalizedProviderUserId = normalizedString(providerUserId);
  const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
  if (!normalizedProviderUserId
    || !tokenSnapshot.exists
    || tokenSnapshot.ref.parent.parent?.id !== firebaseUserID
    || tokenData?.serviceName !== ServiceNames.GarminAPI
    || normalizedString(tokenData.userID) !== normalizedProviderUserId) {
    return null;
  }

  const rootRef = getServiceTokenRootDocumentRef(firebaseUserID, ServiceNames.GarminAPI);
  let deletionGuard;
  let rootSnapshot: admin.firestore.DocumentSnapshot;
  let serviceMeta;
  try {
    [deletionGuard, rootSnapshot, serviceMeta] = await Promise.all([
      getUserDeletionGuardState(db, firebaseUserID),
      rootRef.get(),
      getServiceConnectionMeta(firebaseUserID, ServiceNames.GarminAPI),
    ]);
  } catch {
    throw new GarminHealthAccountValidationError();
  }
  if (deletionGuard.shouldSkip || !rootSnapshot.exists) return null;

  const pinnedProviderUserId = normalizedString(serviceMeta?.providerUserId);
  if (pinnedProviderUserId && pinnedProviderUserId !== normalizedProviderUserId) return null;
  if (serviceMeta?.connectionState === SERVICE_CONNECTION_STATES.DisconnectPending
    || serviceMeta?.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired) {
    return null;
  }

  const credential = getTokenCredentialSnapshot(tokenData);
  if (!credential.accessToken) return null;
  const rootData = rootSnapshot.data() as Record<string, unknown> | undefined;
  if (!doesOAuthCredentialGenerationAuthorizeToken(rootData, credential.credentialGeneration)) {
    return null;
  }
  const rootOAuthCredentialGeneration = normalizedString(
    rootData?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
  );
  const connectionStateGeneration = normalizedString(serviceMeta?.connectionStateGeneration);
  const serviceMetaGuard: HealthLifecycleDocumentFieldGuard | null = serviceMeta
    ? {
      documentRef: db.collection('users').doc(firebaseUserID).collection('meta').doc(ServiceNames.GarminAPI),
      expectedFields: {
        connectionState: serviceMeta.connectionState,
        connectionStateGeneration: serviceMeta.connectionStateGeneration,
        ...(pinnedProviderUserId ? { providerUserId: pinnedProviderUserId } : {}),
      },
    }
    : null;

  return {
    requiredExistingDocumentRef: tokenSnapshot.ref,
    requiredExistingTokenCredential: credential,
    requiredDocumentFieldValues: serviceMetaGuard || undefined,
    additionalRequiredDocumentFieldValues: [{
      documentRef: rootRef,
      expectedFields: {
        [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: expectedGenerationField(
          rootOAuthCredentialGeneration,
        ),
      },
    }],
    providerUserId: normalizedProviderUserId,
    providerIdentityPinned: pinnedProviderUserId === normalizedProviderUserId,
    tokenCredentialGeneration: credential.credentialGeneration,
    rootOAuthCredentialGeneration,
    connectionStateGeneration,
  };
}

export function areGarminHealthWriteLifecycleGuardsContinuous(
  initial: GarminHealthWriteLifecycleGuards,
  current: GarminHealthWriteLifecycleGuards,
): boolean {
  return initial.providerUserId === current.providerUserId
    && initial.providerIdentityPinned === current.providerIdentityPinned
    && initial.tokenCredentialGeneration === current.tokenCredentialGeneration
    && initial.rootOAuthCredentialGeneration === current.rootOAuthCredentialGeneration
    && initial.connectionStateGeneration === current.connectionStateGeneration;
}

export function doesGarminHealthTokenDataMatchGuard(
  tokenData: Record<string, unknown>,
  guard: GarminHealthWriteLifecycleGuards,
): boolean {
  return normalizedString(tokenData.userID) === guard.providerUserId
    && areTokenCredentialSnapshotsEqual(
      getTokenCredentialSnapshot({
        ...tokenData,
        tokenCredentialGeneration: guard.tokenCredentialGeneration || undefined,
      }),
      guard.requiredExistingTokenCredential,
    );
}
