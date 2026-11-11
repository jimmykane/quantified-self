import type { EventRead } from '@shared/event-read';
import { getEventTags } from '@shared/event-tags';
import {
  formatActivityCalendarDuration,
  resolveActivityCalendarEventDurationSeconds,
  resolveActivityCalendarEventLabel,
} from './activity-calendar.helper';
import type { TrainingSessionImpactView } from './training-impact.helper';

export interface CalendarActivityRow {
  id: string;
  name: string;
  tags: string[];
  activityType: string;
  duration: string;
  route: string[] | null;
  trainingImpact?: TrainingSessionImpactView;
}

/** Shared presentation of a recorded activity; reads only the displayed duration. */
export function buildCalendarActivityRow(
  event: EventRead,
  ownerUid: string,
  trainingImpact?: TrainingSessionImpactView,
): CalendarActivityRow {
  const id = event.getID?.() || '';
  const seconds = resolveActivityCalendarEventDurationSeconds(event);
  return {
    id,
    name: resolveActivityCalendarEventLabel(event),
    tags: getEventTags(event),
    activityType: event.getActivityTypesAsString?.() || 'Activity',
    duration: seconds === null ? 'Duration unavailable' : formatActivityCalendarDuration(seconds),
    route: id && ownerUid ? ['/user', ownerUid, 'event', id] : null,
    trainingImpact,
  };
}
