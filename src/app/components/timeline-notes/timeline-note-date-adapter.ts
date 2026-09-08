import { Injectable } from '@angular/core';
import dayjs, { type Dayjs } from 'dayjs';
import { DayjsDateAdapter } from '../../shared/adapters/dayjs-date-adapter';

/** Reuse the app's localized Material calendar, but never roll invalid typed note dates forward. */
@Injectable()
export class TimelineNoteDateAdapter extends DayjsDateAdapter {
  override parse(value: unknown, format: string | string[]): Dayjs | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') return dayjs(value, format, this.locale, true);
    return dayjs.isDayjs(value) ? value.clone() : this.invalid();
  }
}

/** Calendar labels are local date parts, never instants converted through UTC. */
export function timelineNoteDateInput(date: string): Dayjs {
  return dayjs(date, 'YYYY-MM-DD', true);
}
export function timelineNoteDateLabel(date: Dayjs | null): string {
  return date?.isValid() ? date.format('YYYY-MM-DD') : '';
}
