import type { AppEventInterface } from '@shared/app-event.interface';
import { readActivitySourceIdentity } from '@shared/activity-source-identity';
import { hasActivityDiveSourceRecords } from '../helpers/event-dive-source-records.helper';

type EventActivity = NonNullable<ReturnType<AppEventInterface['getActivities']>>[number];

/** Bounded stream-source inputs omitted by Sports Lib JSON; shared with live emission deduplication. */
export function eventSourceVersion(event: AppEventInterface): string {
  const files = event.originalFiles?.length ? event.originalFiles : event.originalFile ? [event.originalFile] : [];
  const identities = (event.getActivities() || []).map(activity => [activity.getID(), readActivitySourceIdentity(
    (activity as EventActivity & { sourceIdentity?: unknown }).sourceIdentity, activity.getID(),
  )] as const).sort(([left], [right]) => `${left}` < `${right}` ? -1 : `${left}` > `${right}` ? 1 : 0);
  return JSON.stringify([event.benchmarkSourceRevision ?? 0,
    files.map(file => [file.path, file.bucket ?? null, file.generation ?? null]), identities]);
}

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
  // Metadata-only live emissions reuse activity instances. Clearing the target
  // would also clear the source and discard its hydrated GPS/chart streams.
  if (sourceActivity === targetActivity) {
    return;
  }

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

  // Stable IDs identify legs, not their current samples. Never attach cached streams to a newer source.
  const haveSameSource = eventSourceVersion(currentEvent) === eventSourceVersion(incomingEvent);

  if (!haveSameActivitySet || !haveSameSource) {
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
