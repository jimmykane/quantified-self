import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { provideRouter } from '@angular/router';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { CalendarDayDetailsComponent, type CalendarDayDetailsData } from './calendar-day-details.component';

describe('CalendarDayDetailsComponent', () => {
  it('shows family totals and event detail links', async () => {
    const fixture = await renderDayDetails(createEvent());

    expect(fixture.nativeElement.textContent).toContain('Running');
    expect(fixture.nativeElement.textContent).toContain('Morning run');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/user/user-1/event/event-1');
  });

  it('replaces generic timestamp names without repeating the activity type', async () => {
    const fixture = await renderDayDetails(createEvent('2026-08-03T08:30:00.000Z', 'New Event'));
    const row = fixture.componentInstance.eventRows[0];

    expect(row.label).toBe('Running');
    expect(row.detailLabel).not.toContain('Running');
    expect(fixture.nativeElement.textContent).not.toContain('2026-08-03T08:30:00.000Z');
    expect(fixture.nativeElement.querySelector('.calendar-day-details')?.getAttribute('aria-label'))
      .toBe('Monday, August 3, 2026');
  });
});

async function renderDayDetails(event: EventInterface) {
  const model = buildActivityCalendarViewModel([event], {
    view: 'month',
    anchorDate: new Date(2026, 7, 3),
    startOfWeek: DaysOfTheWeek.Monday,
    locale: 'en-US',
  });
  const data: CalendarDayDetailsData = {
    day: model.months[0].days.find(day => day.eventCount > 0),
    userId: 'user-1',
    locale: 'en-US',
  } as CalendarDayDetailsData;
  await TestBed.configureTestingModule({
    imports: [CalendarDayDetailsComponent],
    providers: [
      provideRouter([]),
      { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
      { provide: MatBottomSheetRef, useValue: { dismiss: vi.fn() } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CalendarDayDetailsComponent);
  fixture.detectChanges();
  return fixture;
}

function createEvent(name = 'Morning run', description?: string): EventInterface {
  return {
    name,
    description,
    startDate: new Date(2026, 7, 3, 8, 30),
    getID: () => 'event-1',
    getActivityTypesAsArray: () => [ActivityTypes.Running],
    getActivityTypesAsString: () => 'Running',
    getStat: (type: string) => type === DataDuration.type ? { getValue: () => 3600 } : null,
  } as unknown as EventInterface;
}
