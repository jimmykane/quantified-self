import * as admin from 'firebase-admin';
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
  dispatchRecoveryGeneration?: number,
  errors?: QueueItemError[],
  processedAt?: number,
  expireAt?: admin.firestore.Timestamp | Date,
  dispatchedToCloudTask: number | null,
  firebaseUserID?: string,
  resultStatus?: 'success' | 'skipped' | 'deferred',
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
  FITFileURI: string,
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
}

export type SleepSyncQueueItemType =
  | 'garmin_push'
  | 'garmin_ping'
  | 'suunto_webhook'
  | 'suunto_poll'
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
}

export interface QueueItemError {
  date: number,
  error: string,
  atRetryCount: number
}
