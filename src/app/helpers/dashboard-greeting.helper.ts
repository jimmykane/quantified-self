export type DashboardGreetingPeriod = 'morning' | 'afternoon' | 'evening';

/**
 * Greeting copy is centralized here so a future localization pass only needs to
 * touch this map.
 */
export const DASHBOARD_GREETING_COPY: Record<DashboardGreetingPeriod, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
};

/**
 * Buckets a local time into a greeting period:
 * 00:00–11:59 morning, 12:00–17:59 afternoon, 18:00–23:59 evening.
 */
export function getDashboardGreetingPeriod(date: Date): DashboardGreetingPeriod {
  const hours = date.getHours();
  if (hours < 12) {
    return 'morning';
  }
  if (hours < 18) {
    return 'afternoon';
  }
  return 'evening';
}

/**
 * Returns the first non-empty part of the display name, trimmed, or null when
 * no usable name exists. Never derives a name from anything but the display name.
 */
export function getDashboardGreetingName(displayName: string | null | undefined): string | null {
  const firstPart = (displayName || '').trim().split(/\s+/)[0];
  return firstPart ? firstPart : null;
}

/**
 * Builds the full greeting line, e.g. "Good afternoon, Dimitrios", falling back
 * to the plain period greeting without punctuation when no name is available.
 */
export function buildDashboardGreeting(date: Date, displayName?: string | null): string {
  const greetingCopy = DASHBOARD_GREETING_COPY[getDashboardGreetingPeriod(date)];
  const name = getDashboardGreetingName(displayName);
  return name ? `${greetingCopy}, ${name}` : greetingCopy;
}

/**
 * Returns the next local time at which the greeting or the localized date can
 * change: 12:00, 18:00, or the upcoming midnight.
 */
export function getNextDashboardGreetingRefreshTime(date: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const hours = date.getHours();
  if (hours < 12) {
    next.setHours(12);
  } else if (hours < 18) {
    next.setHours(18);
  } else {
    next.setDate(next.getDate() + 1);
  }
  return next;
}
