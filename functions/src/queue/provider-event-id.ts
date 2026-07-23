import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  EventWriteSkippedForDeletedUserError,
  generateEventID,
  generateIDFromParts,
} from '../utils';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

export const PROVIDER_IMPORT_EVENT_ID_RESERVATIONS_COLLECTION = 'providerImportEventIDReservations';

export interface ProviderImportEventIDRequest {
  userID: string;
  startDate: Date;
  serviceName: ServiceNames;
  providerEventID: string | number;
  providerEventIDField: string;
  providerEventSecondaryID?: string | number | null;
  providerEventSecondaryIDField?: string;
  preferProviderIdentityEventID?: boolean;
}

interface ProviderImportEventIDReservation {
  eventID?: unknown;
}

function normalizeProviderIdentityPart(value: string | number | null | undefined): string {
  return `${value ?? ''}`.trim();
}

function metadataMatchesProviderIdentity(
  metadata: admin.firestore.DocumentData | undefined,
  request: ProviderImportEventIDRequest,
): boolean {
  if (!metadata) {
    return false;
  }

  if (normalizeProviderIdentityPart(metadata[request.providerEventIDField]) !== normalizeProviderIdentityPart(request.providerEventID)) {
    return false;
  }

  if (!request.providerEventSecondaryIDField) {
    return true;
  }

  return normalizeProviderIdentityPart(metadata[request.providerEventSecondaryIDField])
    === normalizeProviderIdentityPart(request.providerEventSecondaryID);
}

async function generateProviderIdentityEventID(request: ProviderImportEventIDRequest): Promise<string> {
  return generateIDFromParts([
    request.userID,
    request.serviceName,
    request.providerEventIDField,
    normalizeProviderIdentityPart(request.providerEventID),
    request.providerEventSecondaryIDField || '',
    normalizeProviderIdentityPart(request.providerEventSecondaryID),
  ]);
}

async function generateReservationID(
  request: ProviderImportEventIDRequest,
  primaryEventID: string,
): Promise<string> {
  return generateIDFromParts([
    request.userID,
    request.serviceName,
    primaryEventID,
  ]);
}

function asReservationMap(value: unknown): Record<string, ProviderImportEventIDReservation> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, ProviderImportEventIDReservation>;
}

function hasReservedProviderIdentity(reservations: Record<string, ProviderImportEventIDReservation>): boolean {
  return Object.values(reservations).some((reservation) => typeof reservation?.eventID === 'string' && reservation.eventID.length > 0);
}

function reservationPayload(
  request: ProviderImportEventIDRequest,
  primaryEventID: string,
  identityKey: string,
  eventID: string,
): admin.firestore.DocumentData {
  return {
    serviceName: request.serviceName,
    primaryEventID,
    startDateMs: request.startDate.getTime(),
    updatedAtMs: Date.now(),
    providerIdentities: {
      [identityKey]: {
        eventID,
        providerEventIDField: request.providerEventIDField,
        providerEventID: normalizeProviderIdentityPart(request.providerEventID),
        providerEventSecondaryIDField: request.providerEventSecondaryIDField || null,
        providerEventSecondaryID: request.providerEventSecondaryIDField
          ? normalizeProviderIdentityPart(request.providerEventSecondaryID)
          : null,
      },
    },
  };
}

function logCollision(
  request: ProviderImportEventIDRequest,
  primaryEventID: string,
  collisionSafeEventID: string,
): void {
  logger.warn('[Queue] Provider import event ID collision detected; using provider identity event ID.', {
    userID: request.userID,
    serviceName: request.serviceName,
    startDate: request.startDate.toISOString(),
    primaryEventID,
    collisionSafeEventID,
    providerEventIDField: request.providerEventIDField,
    providerEventID: normalizeProviderIdentityPart(request.providerEventID),
    providerEventSecondaryIDField: request.providerEventSecondaryIDField || null,
    providerEventSecondaryIDPresent: request.providerEventSecondaryIDField
      ? normalizeProviderIdentityPart(request.providerEventSecondaryID).length > 0
      : false,
  });
}

export async function resolveProviderImportEventID(request: ProviderImportEventIDRequest): Promise<string> {
  const db = admin.firestore();
  const primaryEventID = await generateEventID(request.userID, request.startDate);
  const providerIdentityEventID = await generateProviderIdentityEventID(request);
  const reservationID = await generateReservationID(request, primaryEventID);
  const providerIdentityKey = providerIdentityEventID;

  const eventRef = db
    .collection('users')
    .doc(request.userID)
    .collection('events')
    .doc(primaryEventID);
  const metadataRef = eventRef.collection('metaData').doc(request.serviceName);
  const reservationRef = db
    .collection('users')
    .doc(request.userID)
    .collection(PROVIDER_IMPORT_EVENT_ID_RESERVATIONS_COLLECTION)
    .doc(reservationID);

  const selectedEventID = await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, request.userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(request.userID, `provider_import_event_id:${request.serviceName}`, error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn(
        `[Queue] Skipping provider event ID reservation for ${request.serviceName} user ${request.userID} because the user is missing or deletion is in progress.`,
      );
      throw new EventWriteSkippedForDeletedUserError(request.userID, `provider_import_event_id:${request.serviceName}`);
    }

    const metadataSnapshot = await transaction.get(metadataRef);
    if (metadataSnapshot.exists) {
      const eventID = request.preferProviderIdentityEventID
        ? providerIdentityEventID
        : metadataMatchesProviderIdentity(metadataSnapshot.data(), request)
          ? primaryEventID
          : providerIdentityEventID;
      transaction.set(
        reservationRef,
        reservationPayload(request, primaryEventID, providerIdentityKey, eventID),
        { merge: true },
      );
      return eventID;
    }

    const reservationSnapshot = await transaction.get(reservationRef);
    const providerIdentities = asReservationMap(reservationSnapshot.data()?.providerIdentities);
    const existingReservation = providerIdentities[providerIdentityKey];
    if (typeof existingReservation?.eventID === 'string' && existingReservation.eventID.length > 0) {
      return existingReservation.eventID;
    }

    const eventID = request.preferProviderIdentityEventID || hasReservedProviderIdentity(providerIdentities)
      ? providerIdentityEventID
      : primaryEventID;
    transaction.set(
      reservationRef,
      reservationPayload(request, primaryEventID, providerIdentityKey, eventID),
      { merge: true },
    );
    return eventID;
  });

  if (selectedEventID !== primaryEventID && !request.preferProviderIdentityEventID) {
    logCollision(request, primaryEventID, selectedEventID);
  }

  return selectedEventID;
}
