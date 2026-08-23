import { AppEventInterface } from '@shared/app-event.interface';
import { hasActivityDiveSourceRecords } from '../helpers/event-dive-source-records.helper';

type EventActivity = NonNullable<ReturnType<AppEventInterface['getActivities']>>[number];

export interface EventLiveReconcileResult {
  reconciledEvent: AppEventInterface;
  selectedActivityIDs: string[];
  needsFullReload: boolean;
}

function filterSelectedIDsByAvailableActivities(activities: EventActivity[], selectedActivityIDs: string[]): string[] {
  if (!selectedActivityIDs?.length) {
    return [];
  }
  const availableIDs = new Set((activities || []).map((activity) => activity.getID()));
  return selectedActivityIDs.filter((activityID) => availableIDs.has(activityID));
}

function preserveActivitySourceHydrationData(sourceActivity: EventActivity, targetActivity: EventActivity): void {
  targetActivity.clearStreams();
  targetActivity.addStreams(sourceActivity.getAllStreams());

  // Streams are deliberately absent from Firestore. Dive source records are
  // persisted from Sports Lib 20.1.1 onward, so an incoming persisted payload wins.
  // Keep the retained-source copy only as a fallback for older activity docs.
  if (!hasActivityDiveSourceRecords(targetActivity)) {
    targetActivity.setDiveSourceRecords(sourceActivity.getDiveSourceRecords());
  }
}

export function reconcileEventDetailsLiveUpdate(
  currentEvent: AppEventInterface | null,
  incomingEvent: AppEventInterface,
  selectedActivityIDs: string[],
): EventLiveReconcileResult {
  const incomingActivities = incomingEvent?.getActivities?.() || [];

  if (!currentEvent) {
    return {
      reconciledEvent: incomingEvent,
      selectedActivityIDs: filterSelectedIDsByAvailableActivities(incomingActivities, selectedActivityIDs),
      needsFullReload: false,
    };
  }

  const currentActivities = currentEvent.getActivities() || [];
  const currentActivitiesByID = new Map(currentActivities.map((activity) => [activity.getID(), activity]));
  const currentActivityIDs = currentActivities.map((activity) => activity.getID());
  const incomingActivityIDs = incomingActivities.map((activity) => activity.getID());

  const haveSameActivitySet = currentActivityIDs.length === incomingActivityIDs.length
    && incomingActivityIDs.every((activityID) => currentActivitiesByID.has(activityID));

  if (!haveSameActivitySet) {
    return {
      reconciledEvent: incomingEvent,
      selectedActivityIDs: filterSelectedIDsByAvailableActivities(incomingActivities, selectedActivityIDs),
      needsFullReload: true,
    };
  }

  incomingActivities.forEach((incomingActivity) => {
    const currentActivity = currentActivitiesByID.get(incomingActivity.getID());
    if (!currentActivity) {
      return;
    }
    preserveActivitySourceHydrationData(currentActivity, incomingActivity);
  });

  return {
    reconciledEvent: incomingEvent,
    selectedActivityIDs: filterSelectedIDsByAvailableActivities(incomingActivities, selectedActivityIDs),
    needsFullReload: false,
  };
}
