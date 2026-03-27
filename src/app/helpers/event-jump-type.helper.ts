import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataJumpEvent } from '@sports-alliance/sports-lib';

export type EventJumpActivityLike = Pick<ActivityInterface, 'getAllEvents'>;

function isJumpLikeEvent(event: unknown): boolean {
  if (event instanceof DataJumpEvent) {
    return true;
  }

  if (!event || typeof event !== 'object' || !('jumpData' in (event as Record<string, unknown>))) {
    return false;
  }

  const jumpData = (event as { jumpData?: unknown }).jumpData;
  return !!(jumpData && typeof jumpData === 'object');
}

export function hasVisibleEventJumps(activities: readonly EventJumpActivityLike[] | null | undefined): boolean {
  return (activities || []).some((activity) =>
    (activity.getAllEvents?.() || []).some((event) => isJumpLikeEvent(event))
  );
}
