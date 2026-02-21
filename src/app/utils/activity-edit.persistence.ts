import { ActivityInterface, EventInterface } from '@sports-alliance/sports-lib';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../functions/src/shared/firestore-write-sanitizer';

export interface ActivityEditWritePayload {
  activityData: any;
  eventData: any;
}

export function buildActivityWriteData(userID: string, event: EventInterface, activity: ActivityInterface): any {
  const activityData = sanitizeActivityFirestoreWritePayload(
    activity.toJSON() as Record<string, unknown>
  ) as any;

  activityData.eventID = event.getID();
  activityData.userID = userID;
  if (event.startDate) {
    activityData.eventStartDate = event.startDate;
  }

  return activityData;
}

export function buildEventWriteData(event: EventInterface): any {
  const eventData = sanitizeEventFirestoreWritePayload(
    event.toJSON() as Record<string, unknown>
  ) as any;
  const eventAny = event as any;

  // Preserve original file metadata across partial updates.
  if (eventAny.originalFiles) {
    eventData.originalFiles = eventAny.originalFiles;
  }
  if (eventAny.originalFile) {
    eventData.originalFile = eventAny.originalFile;
  }

  return eventData;
}

export function buildActivityEditWritePayload(
  userID: string,
  event: EventInterface,
  activity: ActivityInterface,
): ActivityEditWritePayload {
  return {
    activityData: buildActivityWriteData(userID, event, activity),
    eventData: buildEventWriteData(event),
  };
}
