import * as admin from 'firebase-admin';
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

export interface QueueItemError {
  date: number,
  error: string,
  atRetryCount: number
}
