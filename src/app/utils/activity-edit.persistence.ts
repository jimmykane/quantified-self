import { ActivityInterface, EventInterface } from '@sports-alliance/sports-lib';

export interface ActivityEditWritePayload {
  activityData: any;
  eventData: any;
}

export function buildActivityWriteData(userID: string, event: EventInterface, activity: ActivityInterface): any {
  const activityData = activity.toJSON() as any;

  // Activity documents should not persist streams; they come from source files/rehydration.
  delete activityData.streams;

  activityData.eventID = event.getID();
  activityData.userID = userID;
  if (event.startDate) {
    activityData.eventStartDate = event.startDate;
  }

  return activityData;
}

export function buildEventWriteData(event: EventInterface): any {
  const eventData = event.toJSON() as any;
  const eventAny = event as any;

  // Event documents should not persist embedded activities.
  // Activities (and their streams) live in /users/{uid}/activities and stream files.
  delete eventData.activities;

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
