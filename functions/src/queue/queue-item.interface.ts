import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { RouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';
import { SleepProvider } from '../../../shared/sleep';
import DocumentReference = admin.firestore.DocumentReference;

export interface QueueItemInterface {
  id: string,
  ref?: DocumentReference
  dateCreated: number,
  processed: false,
  retryCount: number,
  totalRetryCount?: number,
  /** Opaque provider-payload revision used to reject stale Cloud Task writes. */
  queueRevision?: string,
  dispatchRecoveryGeneration?: number,
  errors?: QueueItemError[],
  processedAt?: number,
  expireAt?: Timestamp | Date,
  dispatchedToCloudTask: number | null,
  providerOperationStartedAt?: number | null,
  /** Worker lease that serializes revision-sensitive provider processing and event persistence. */
  processingOwner?: string,
  processingRevision?: string,
  processingLeaseExpiresAt?: number,
  firebaseUserID?: string,
  resultStatus?: 'success' | 'skipped' | 'deferred' | 'manual_reconciliation_required',
  manualReconciliationRequiredAt?: number,
  manualReconciliationContext?: string,
  deferredReason?: string,
  deferredContext?: string,
  serviceDisconnectPendingDeferredAt?: number,
}

export interface SuuntoAppWorkoutQueueItemInterface extends QueueItemInterface {
  workoutID: string,
  userName: string,
}

export interface COROSAPIWorkoutQueueItemInterface extends QueueItemInterface {
  workoutID: string,
  openId: string,
  FITFileURI?: string,
  mode?: number,
  subMode?: number,
  detailMode?: number,
  detailSubMode?: number,
  deviceName?: string,
  startTimezone?: number,
  endTimezone?: number,
  planWorkoutId?: string,
  componentIndex?: number,
  componentKey?: string,
}

export interface WahooAPIWorkoutQueueItemInterface extends QueueItemInterface {
  wahooUserID: string;
  workoutID: string;
  workoutSummaryID: string;
  summaryUpdatedAt: string;
  FITFileURI: string;
  starts: string;
  manual?: boolean;
  edited?: boolean;
  fitnessAppID?: number;
  fromHistory?: boolean;
}

export interface GarminAPIActivityQueueItemInterface extends QueueItemInterface {
  userID: string
  startTimeInSeconds: number,
  manual: boolean,
  activityFileID: string,
  activityFileType: 'FIT' | 'TCX' | 'GPX',
  token: string,
  userAccessToken: string,
  callbackURL: string
}

export interface ActivitySyncOriginalFileMetadata {
  path: string;
  bucket?: string;
  startDate?: number;
  originalFilename?: string;
  extension?: string;
}

export interface ActivitySyncUploadContinuation {
  type: 'suunto_blob_put_v1';
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
}

export interface ActivitySyncQueueItemInterface extends QueueItemInterface {
  routeId: ActivitySyncRouteId;
  sourceServiceName: ServiceNames;
  destinationServiceName: ServiceNames;
  userID: string;
  eventID: string;
  sourceActivityID?: string;
  originalFile: ActivitySyncOriginalFileMetadata;
  manual: boolean;
  successProcessedAt?: number;
  destinationUploadID?: string | null;
  destinationProviderUserID?: string | null;
  destinationWorkoutKey?: string | null;
  destinationInfoCode?: string | null;
  destinationUploadCountedID?: string | null;
  destinationUploadCountedAt?: number;
  destinationUploadContinuation?: ActivitySyncUploadContinuation | null;
  /** Durable marker proving provider-echo fingerprints were written before upload. */
  outboundFingerprintID?: string | null;
}

export interface RouteSyncQueueItemInterface extends QueueItemInterface {
  sourceServiceName: ServiceNames;
  providerUserId: string;
  providerRouteId: string;
  providerRouteName?: string;
  providerRouteCreatedAt?: number | null;
  providerRouteModifiedAt?: number | null;
  manual: boolean;
  resultRouteId?: string;
  skippedReason?: string;
}

export interface RouteDeliverySyncQueueItemInterface extends QueueItemInterface {
  routeId: RouteDeliverySyncRouteId;
  sourceServiceName: ServiceNames;
  destinationServiceName: ServiceNames;
  userID: string;
  savedRouteID: string;
  sourceRevisionKey: string;
  sourceProviderRouteId?: string;
  sourceProviderUserId?: string;
  manual: boolean;
  skippedReason?: string;
  successProcessedAt?: number;
  destinationDeliveryAcceptedAt?: number;
  destinationDeliveryComplete?: boolean;
  destinationProviderRouteId?: string | null;
  /** Provider identity retained only for manual reconciliation of an ambiguous create. */
  destinationProviderUserId?: string | null;
  /** Typed provider operation that produced the manual-reconciliation record. */
  destinationProviderOperation?: string | null;
  destinationDeliveries?: Array<{
    providerUserId: string | null;
    providerRouteId: string | null;
  }>;
}

export type SleepSyncQueueItemType =
  | 'garmin_push'
  | 'garmin_ping'
  | 'suunto_webhook'
  | 'suunto_poll'
  | 'suunto_health_poll'
  | 'coros_poll';

export interface SleepSyncQueueItemInterface extends QueueItemInterface {
  type: SleepSyncQueueItemType;
  provider: SleepProvider;
  userID?: string;
  providerUserId: string;
  payload?: unknown;
  callbackURL?: string;
  rangeStartMs?: number;
  rangeEndMs?: number;
  healthTrigger?: 'poll' | 'webhook' | 'backfill';
  /** Webhook-only fence captured from the server-owned Suunto account binding. */
  suuntoHealthTokenCredentialGeneration?: string | null;
  /** Webhook-only fence captured from the current Suunto token-root OAuth revision. */
  suuntoHealthRootOAuthCredentialGeneration?: string | null;
  /** Webhook-only fence captured from the authoritative service connection metadata. */
  suuntoHealthConnectionStateGeneration?: string | null;
  /** Opaque binding/token/root/connection authority fence for signed Suunto Sleep payloads. */
  suuntoWebhookAuthorityDigest?: string;
}

export interface QueueItemError {
  date: number,
  error: string,
  atRetryCount: number
}
