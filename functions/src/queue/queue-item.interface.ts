export interface QueueItemInterface {
  id: string,
  retryCount: number,
  totalRetryCount: number,
  processed: false,
  errors: QueueItemError[],
  processedAt: number
}

export interface SuuntoAppWorkoutQueueItemInterface extends QueueItemInterface{
  workoutID: string,
  userName: string,
}

export interface GarminHealthAPIActivityQueueItemInterface extends QueueItemInterface{
  userID: string
  activityID: string,
}

export interface QueueItemError {
  date: number,
  error: string,
  atRetryCount: number
}
