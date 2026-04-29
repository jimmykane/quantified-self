import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { SleepProvider } from '../../../shared/sleep';
import DocumentReference = admin.firestore.DocumentReference;

export interface QueueItemInterface {
  id: string,
  ref?: DocumentReference
  dateCreated: number,
  processed: false,
  retryCount: number,
  totalRetryCount?: number,
  errors?: QueueItemError[],
  processedAt?: number,
  expireAt?: admin.firestore.Timestamp | Date,
  dispatchedToCloudTask: number | null,
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
  resultStatus?: 'success' | 'skipped';
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
