import type { MarketingDailySchedule } from './admin-marketing';

export function validateMarketingSchedule(value: unknown): MarketingDailySchedule | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Sending schedule is invalid.');
  const schedule = value as Record<string, unknown>;
  if (Object.keys(schedule).some(key => key !== 'time' && key !== 'timeZone') ||
      typeof schedule.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) ||
      typeof schedule.timeZone !== 'string' || schedule.timeZone.length > 100 ||
      !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(schedule.timeZone)) {
    throw new Error('Choose a daily time (HH:mm) and a valid timezone.');
  }
  try {
    const timeZone = new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone }).resolvedOptions().timeZone;
    return { time: schedule.time, timeZone };
  } catch {
    throw new Error('Choose a valid timezone, such as Europe/Helsinki.');
  }
}

function calendar(schedule: MarketingDailySchedule) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const wallTime = (instant: number): number => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  };
  const occurrence = (localDay: number): number => {
    const [hour, minute] = schedule.time.split(':').map(Number);
    const target = localDay + hour * 3_600_000 + minute * 60_000;
    // Collect both offsets around a DST transition. Resolve repeated times to
    // their first occurrence; shift nonexistent times forward by the DST gap.
    const offsets = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 12) {
      const instant = target + hours * 3_600_000;
      offsets.add(wallTime(instant) - instant);
    }
    const candidates = [...offsets].map(offset => target - offset);
    const exact = candidates.filter(instant => wallTime(instant) === target);
    if (exact.length) return Math.min(...exact);
    const later = candidates.filter(instant => wallTime(instant) > target)
      .sort((a, b) => wallTime(a) - wallTime(b) || a - b);
    if (!later.length) throw new Error('Cannot resolve this daily sending time.');
    return later[0];
  };
  const localDay = (instant: number): number => Math.floor(wallTime(instant) / 86_400_000) * 86_400_000;
  return { occurrence, localDay };
}

/** Next daily occurrence, once per local date even when the clock repeats. */
export function nextMarketingSendAt(schedule: MarketingDailySchedule, now: Date, inclusive = false): string {
  const { occurrence, localDay } = calendar(schedule);
  let day = localDay(now.getTime());
  let instant = occurrence(day);
  while (inclusive ? instant < now.getTime() : instant <= now.getTime()) {
    day += 86_400_000;
    instant = occurrence(day);
  }
  return new Date(instant).toISOString();
}

export interface MarketingScheduleState {
  nextScheduledSendAt?: string | null;
  scheduledDispatchUtcDate?: string | null;
}

/** Arm Start/Resume. A paused batch can continue only within the same UTC day. */
export function armMarketingSchedule(schedule: MarketingDailySchedule | null, state: MarketingScheduleState,
  now: Date): MarketingScheduleState {
  if (!schedule) return { nextScheduledSendAt: null, scheduledDispatchUtcDate: null };
  if (state.scheduledDispatchUtcDate === now.toISOString().slice(0, 10)) {
    return { nextScheduledSendAt: state.nextScheduledSendAt || null, scheduledDispatchUtcDate: state.scheduledDispatchUtcDate };
  }
  return { nextScheduledSendAt: nextMarketingSendAt(schedule, now, true), scheduledDispatchUtcDate: null };
}

export function marketingScheduleGate(schedule: MarketingDailySchedule | null, state: MarketingScheduleState,
  now: Date): { due: boolean; state: MarketingScheduleState } {
  if (!schedule) return { due: true, state: {} };
  const today = now.toISOString().slice(0, 10);
  if (state.scheduledDispatchUtcDate === today) return { due: true, state: {} };
  const armedAt = Date.parse(state.nextScheduledSendAt || '');
  if (!Number.isFinite(armedAt) || armedAt > now.getTime()) return { due: false, state: {} };
  const { occurrence, localDay } = calendar(schedule);
  let latest = occurrence(localDay(now.getTime()));
  if (latest > now.getTime()) latest = occurrence(localDay(now.getTime()) - 86_400_000);
  // Catch up a delayed worker during the occurrence's UTC day. A five-minute
  // grace also allows the cron tick just after a time close to UTC midnight.
  const recent = new Date(latest).toISOString().slice(0, 10) === today || now.getTime() - latest <= 5 * 60_000;
  if (latest < armedAt || !recent) return { due: false, state: {} };
  return { due: true, state: { scheduledDispatchUtcDate: today,
    nextScheduledSendAt: nextMarketingSendAt(schedule, now) } };
}
