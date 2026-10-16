import { createHash } from 'node:crypto';
import { EventImporterJSON, EventUtilities, Privacy, type EventInterface } from '@sports-alliance/sports-lib';

/** Stable through merge retries, without reusing a source activity document. */
export function mergedActivityId(resultId: string, eventId: string, activityId: string): string {
  return `merge_${createHash('sha256').update(JSON.stringify([resultId, eventId, activityId])).digest('hex').slice(0, 40)}`;
}

/** Stored activity documents are streamless. Aggregation must never recalculate their recorded statistics. */
export function mergeRecordedEvents(events: EventInterface[], resultId: string): EventInterface {
  const sorted = [...events].sort((left, right) => +left.getFirstActivity().startDate - +right.getFirstActivity().startDate);
  const activities = sorted.flatMap(event => event.getActivities().map(activity => {
    activity.setID(mergedActivityId(resultId, event.getID()!, activity.getID()!));
    return activity;
  }));
  if (!activities.length || activities.length > 100) throw new Error('Merge supports between 1 and 100 activities.');
  const first = sorted[0];
  const event = EventImporterJSON.getEventFromJSON({ name: `Merged at ${new Date().toISOString()}`,
    startDate: +activities[0].startDate, endDate: +activities[activities.length - 1].endDate,
    srcFileType: first.srcFileType, privacy: Privacy.Private, description: '', isMerge: false, stats: {}, activities: [] });
  event.setID(resultId);
  event.addActivities(activities);
  // Only the parent summaries are rebuilt; no ActivityUtilities generation or TSS evaluation occurs here.
  EventUtilities.reGenerateStatsForEvent(event);
  return event;
}
