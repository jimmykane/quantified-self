import { describe, expect, it, vi } from 'vitest';
import { AppEventSummary } from '@shared/event-summary';
import { ActivityTypes, DataDuration, FileType, Privacy } from '@sports-alliance/sports-lib';
import { buildCalendarActivityRow } from './calendar-activity-row.helper';

const event = (duration?: number) => new AppEventSummary({ id: 'ride', name: 'Morning ride', description: null,
  startDate: 0, endDate: 3_600_000, srcFileType: FileType.FIT, privacy: Privacy.Private, isMerge: false,
  stats: { 'Activity Types': [ActivityTypes.Cycling], ...(duration === undefined ? {} : { Duration: duration }), Distance: 12000 } });

describe('Shared calendar activity row', () => {
  it('reuses the calendar title, sport, tags, duration and owner route without reading unrelated metrics', () => {
    const ride = event(5760); ride.tags = ['Race', 'Autumn build'];
    const stat = vi.spyOn(ride, 'getStat');
    expect(buildCalendarActivityRow(ride, 'owner')).toMatchObject({ id: 'ride', name: 'Morning ride',
      activityType: 'Cycling', tags: ['Race', 'Autumn build'], duration: '1h 36m', route: ['/user', 'owner', 'event', 'ride'] });
    expect(stat).toHaveBeenCalledExactlyOnceWith(DataDuration.type);
  });
  it('keeps missing and zero duration distinct, with navigation unavailable without an owner', () => {
    expect(buildCalendarActivityRow(event(), 'owner').duration).toBe('Duration unavailable');
    expect(buildCalendarActivityRow(event(0), '').duration).toBe('0m');
    expect(buildCalendarActivityRow(event(0), '').route).toBeNull();
  });
});
