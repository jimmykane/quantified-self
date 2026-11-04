import { ServiceNames } from '@sports-alliance/sports-lib';
import { connectionHistoryRange, historyRangeOptions, type ConnectionHistoryRangePreset } from '@shared/connection-history';
import dayjs from 'dayjs';

/** Reuse provider range policy, translating its calendar dates into the manual picker's local days. */
export function activityHistoryRange(service: ServiceNames, preset: ConnectionHistoryRangePreset,
  now: Date, minimum: Date | null = null): { startDate: Date; endDate: Date } {
  if (!Number.isFinite(now.getTime()) || !historyRangeOptions(service).some(option => option.value === preset)) {
    throw new Error('Invalid activity history range.');
  }
  const calendarNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const utcStart = new Date(connectionHistoryRange(calendarNow, service, preset).startMs);
  const localStart = new Date(utcStart.getUTCFullYear(), utcStart.getUTCMonth(), utcStart.getUTCDate());
  const minimumDay = minimum ? dayjs(minimum).startOf('day').toDate() : null;
  return {
    startDate: minimumDay && minimumDay > localStart ? minimumDay : localStart,
    endDate: dayjs(now).endOf('day').toDate(),
  };
}
