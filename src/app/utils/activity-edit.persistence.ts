import { ActivityInterface, EventInterface } from '@sports-alliance/sports-lib';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../functions/src/shared/firestore-write-sanitizer';

export interface ActivityEditWritePayload {
  activityData: Record<string, unknown>;
  eventData: Record<string, unknown>;
}

export function buildActivityWriteData(userID: string, event: EventInterface, activity: ActivityInterface): Record<string, unknown> {
  // Mandatory shared write policy: sanitize at the payload boundary before Firestore writes.
  const activityData = sanitizeActivityFirestoreWritePayload(
    activity.toJSON()
  );

  activityData.eventID = event.getID();
  activityData.userID = userID;
  if (event.startDate) {
    activityData.eventStartDate = event.startDate;
  }

  return activityData;
}

export function buildEventWriteData(event: EventInterface): Record<string, unknown> {
  // Mandatory shared write policy: sanitize at the payload boundary before Firestore writes.
  const eventData = sanitizeEventFirestoreWritePayload(
    event.toJSON()
  );
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
