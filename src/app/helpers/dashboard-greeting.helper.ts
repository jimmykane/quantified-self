const DASHBOARD_GREETING_AFTERNOON_HOUR = 12;
const DASHBOARD_GREETING_EVENING_HOUR = 18;

export function formatDashboardGreeting(date: Date, displayName?: string | null): string {
  const hour = date.getHours();
  const greeting = hour < DASHBOARD_GREETING_AFTERNOON_HOUR
    ? 'Good morning'
    : hour < DASHBOARD_GREETING_EVENING_HOUR
      ? 'Good afternoon'
      : 'Good evening';
  const firstName = `${displayName ?? ''}`.trim().split(/\s+/)[0];

  return firstName ? `${greeting}, ${firstName}` : greeting;
}

export function resolveNextDashboardGreetingBoundaryMs(date: Date): number {
  const nextBoundary = new Date(date.getTime());
  const hour = date.getHours();

  if (hour < DASHBOARD_GREETING_AFTERNOON_HOUR) {
    nextBoundary.setHours(DASHBOARD_GREETING_AFTERNOON_HOUR, 0, 0, 0);
    return nextBoundary.getTime();
  }

  if (hour < DASHBOARD_GREETING_EVENING_HOUR) {
    nextBoundary.setHours(DASHBOARD_GREETING_EVENING_HOUR, 0, 0, 0);
    return nextBoundary.getTime();
  }

  nextBoundary.setDate(nextBoundary.getDate() + 1);
  nextBoundary.setHours(0, 0, 0, 0);
  return nextBoundary.getTime();
}
