import {
  ActivityInterface,
  DiveSourceRecords,
} from '@sports-alliance/sports-lib';
import { isDivingActivity } from './event-diving.helper';

export interface EventDiveSourceRecordActivity {
  activity: ActivityInterface;
  records: DiveSourceRecords;
}

export function hasActivityDiveSourceRecords(
  activity: Pick<ActivityInterface, 'getDiveSourceRecords'>,
): boolean {
  const records = activity.getDiveSourceRecords();
  return records.gases.length > 0
    || records.tankSummaries.length > 0
    || records.tankUpdates.length > 0;
}

export function hasEventDiveSourceRecords(
  activities: readonly ActivityInterface[] | null | undefined,
): boolean {
  return (activities || []).some((activity) => {
    if (!isDivingActivity(activity)) {
      return false;
    }

    return hasActivityDiveSourceRecords(activity);
  });
}

export function getEventDiveSourceRecordActivities(
  activities: readonly ActivityInterface[] | null | undefined,
): EventDiveSourceRecordActivity[] {
  return (activities || []).reduce<EventDiveSourceRecordActivity[]>((sourceActivities, activity) => {
    if (!isDivingActivity(activity)) {
      return sourceActivities;
    }

    if (!hasActivityDiveSourceRecords(activity)) {
      return sourceActivities;
    }

    const records = activity.getDiveSourceRecords();
    sourceActivities.push({ activity, records });
    return sourceActivities;
  }, []);
}
