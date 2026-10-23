import type { EventInterface, EventJSONInterface } from '@sports-alliance/sports-lib';
import type { AppEventInterface } from './app-event.interface';

export type AppEventMetadata = Omit<AppEventInterface, keyof EventInterface>;

/** Read contract shared by complete events and summary projections. No complete-event persistence API. */
export interface EventRead extends Pick<EventInterface,
  'name' | 'description' | 'startDate' | 'endDate' | 'privacy' | 'isMerge' | 'srcFileType' |
  'getActivityTypesAsArray' | 'getActivityTypesAsString' | 'getDeviceNamesAsString'>, AppEventMetadata {
  getID(): string | null;
  getStat: EventInterface['getStat'];
  getDistance(): ReturnType<EventInterface['getDistance']> | undefined;
  getDuration(): ReturnType<EventInterface['getDuration']> | undefined;
  /** Only complete readers can supply child activity models. */
  getActivities?: EventInterface['getActivities'];
  /** Reflect an already committed scalar patch in the local summary. Never persists it. */
  applySavedStat?(type: string, value: number | null): void;
  /** Only for existing whole-source fingerprint validation, never row caching or display. */
  getSourceSnapshot?(): Pick<EventJSONInterface, 'startDate' | 'endDate' | 'stats'> & { type?: unknown };
  /** Summary revision also observes mutations of metrics already requested by the consumer. */
  getReadRevision?(types: readonly string[]): string;
}

export function isCompleteEvent(event: EventRead): event is AppEventInterface {
  return 'toJSON' in event && typeof event.toJSON === 'function' && typeof event.getActivities === 'function';
}
