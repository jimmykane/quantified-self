import { AppEventInterface } from '../../../functions/src/shared/app-event.interface';

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

function preserveActivityStreams(sourceActivity: EventActivity, targetActivity: EventActivity): void {
  const sourceGetStreams = (sourceActivity as any)?.getAllStreams ?? (sourceActivity as any)?.getStreams;
  const targetClearStreams = (targetActivity as any)?.clearStreams;
  const targetAddStreams = (targetActivity as any)?.addStreams;

  if (
    typeof sourceGetStreams !== 'function'
    || typeof targetClearStreams !== 'function'
    || typeof targetAddStreams !== 'function'
  ) {
    return;
  }

  const streams = sourceGetStreams.call(sourceActivity) || [];
  targetClearStreams.call(targetActivity);
  targetAddStreams.call(targetActivity, streams);
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
    preserveActivityStreams(currentActivity, incomingActivity);
  });

  return {
    reconciledEvent: incomingEvent,
    selectedActivityIDs: filterSelectedIDsByAvailableActivities(incomingActivities, selectedActivityIDs),
    needsFullReload: false,
  };
}
