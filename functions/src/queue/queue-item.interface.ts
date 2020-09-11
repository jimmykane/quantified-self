export interface QueueItemInterface {
  id: string,
  dateCreated: number,
  processed: false,
  retryCount: number,
  totalRetryCount?: number,
  errors?: QueueItemError[],
  processedAt?: number
}

export interface SuuntoAppWorkoutQueueItemInterface extends QueueItemInterface{
  workoutID: string,
  userName: string,
}

export interface COROSAPIWorkoutQueueItemInterface extends QueueItemInterface{
  workoutID: string,
  openId: string,
  FITFileURI: string,
}

export interface GarminHealthAPIActivityQueueItemInterface extends QueueItemInterface{
  userID: string
  startTimeInSeconds: number,
  manual: boolean,
  activityFileID: string,
  activityFileType: 'FIT' | 'TCX' | 'GPX'
}

export interface QueueItemError {
  date: number,
  error: string,
  atRetryCount: number
}
