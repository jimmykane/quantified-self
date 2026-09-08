import { Injectable } from '@angular/core';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { isTimelineDate, timelineToday } from '@shared/timeline-notes';
import { DayjsDateAdapter } from '../../shared/adapters/dayjs-date-adapter';

dayjs.extend(utc);

/** Reuse the app's localized Material calendar, but never roll invalid typed note dates forward. */
@Injectable()
export class TimelineNoteDateAdapter extends DayjsDateAdapter {
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  override today(): Dayjs {
    return timelineNoteDateInput(timelineToday(this.timeZone));
  }
  override createDate(year: number, month: number, date: number): Dayjs {
    // UTC is only a calendar carrier, not a conversion of an observation timestamp. A browser zone
    // can skip an entire date (e.g. Apia 2011-12-30), which must remain a valid fixed note label.
    return dayjs.utc(0).year(year).month(month).date(date).startOf('day');
  }
  override parse(value: unknown, format: string | string[]): Dayjs | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
      // The app's L format is numeric and localized (day/month ordering and separators). Resolve
      // it explicitly so parsing does not depend on another adapter's global Dayjs locale.
      for (const pattern of Array.isArray(format) ? format : [format]) {
        const resolved = pattern === 'L' ? dayjs().locale(this.locale).localeData().longDateFormat('L') : pattern;
        const parsed = dayjs.utc(value, resolved, true).locale(this.locale);
        if (parsed.isValid()) return parsed;
      }
      return this.invalid();
    }
    return dayjs.isDayjs(value) ? value.utc(true) : this.invalid();
  }
}

/** Construct the fixed label in a zone-independent carrier; never convert it from a local instant. */
export function timelineNoteDateInput(date: string): Dayjs {
  return isTimelineDate(date) ? dayjs.utc(Date.parse(`${date}T00:00:00Z`)) : dayjs.utc(null);
}
export function timelineNoteDateLabel(date: Dayjs | null): string {
  return date?.isValid() ? date.format('YYYY-MM-DD') : '';
}
