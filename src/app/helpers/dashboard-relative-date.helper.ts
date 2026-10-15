import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { getDateTimeFormatter } from './date-time-format.helper';

dayjs.extend(relativeTime);

/** Today is a local calendar day, not the formula's 48-hour evidence window. */
export function buildDashboardTodaySleepStatus(
  latestSleepAtMs: number | null | undefined,
  options: { nowMs?: number; locale?: string } = {},
) {
  const now = new Date(options.nowMs ?? Date.now());
  const latest = latestSleepAtMs == null ? null : new Date(latestSleepAtMs);
  const hasCompletedNight = latest !== null && Number.isFinite(latest.getTime())
    && latest.getTime() > 0 && latest.getTime() <= now.getTime();
  const isToday = hasCompletedNight && latest.toDateString() === now.toDateString();
  const dateText = hasCompletedNight ? getDateTimeFormatter(options.locale, {
    day: 'numeric', month: 'short',
    ...(latest.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  }).format(latest) : '';
  return {
    awaitingSleep: !isToday,
    contextText: isToday ? 'Today' : dateText ? `Last available · ${dateText}` : 'No completed night',
    // Construct the next local midnight so DST days are not treated as 24 hours.
    refreshAtMs: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(),
  };
}

export function formatDashboardRelativeDay(
  timestampMs: number | null | undefined,
  options: { nowMs?: number; locale?: string } = {},
): string {
  if (!Number.isFinite(timestampMs)) {
    return 'No eligible night';
  }

  const now = dayjs(options.nowMs ?? Date.now()).locale(options.locale || 'en');
  const date = dayjs(timestampMs).locale(options.locale || 'en');
  if (!now.isValid() || !date.isValid()) {
    return 'No eligible night';
  }

  const dayDifference = now.startOf('day').diff(date.startOf('day'), 'day');
  if (dayDifference === 0) {
    return 'Today';
  }
  if (dayDifference === 1) {
    return 'Yesterday';
  }
  return date.startOf('day').from(now.startOf('day'));
}
