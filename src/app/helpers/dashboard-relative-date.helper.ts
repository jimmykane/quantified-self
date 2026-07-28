import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

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
