import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { provideRouter } from '@angular/router';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { CalendarDayDetailsComponent, type CalendarDayDetailsData } from './calendar-day-details.component';

describe('CalendarDayDetailsComponent', () => {
  it('shows family totals and event detail links', async () => {
    const fixture = await renderDayDetails(createEvent());

    expect(fixture.nativeElement.textContent).toContain('Running');
    expect(fixture.nativeElement.textContent).toContain('Morning run');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/user/user-1/event/event-1');
    expect(fixture.nativeElement.querySelectorAll('.calendar-day-family-list mat-list-item')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.calendar-day-family-duration')?.textContent).toContain('1h');
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

  it('renders each event with its resolved activity icon', async () => {
    const fixture = await renderDayDetails(createEvent('2026-08-03T08:30:00.000Z', 'Downhill ride', 'Downhill Cycling'));

    const eventIcon = fixture.nativeElement.querySelector('mat-nav-list app-activity-type-icon mat-icon');
    expect(eventIcon?.textContent?.trim()).toBe('terrain');
  });

  it('uses the shared bottom-sheet surface without an inset background', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-day-details/calendar-day-details.component.scss'),
      'utf8',
    );

    expect(styles).not.toMatch(/\.calendar-day-details\s*\{[^}]*\bbackground\s*:/s);
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
      {
        provide: AppEventColorService,
        useValue: {
          getActivityColor: vi.fn().mockReturnValue(''),
          getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue(''),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CalendarDayDetailsComponent);
  fixture.detectChanges();
  return fixture;
}

function createEvent(
  name = 'Morning run',
  description?: string,
  activityType = 'Running',
): EventInterface {
  return {
    name,
    description,
    startDate: new Date(2026, 7, 3, 8, 30),
    getID: () => 'event-1',
    getActivityTypesAsArray: () => [activityType === 'Downhill Cycling' ? ActivityTypes.DownhillCycling : ActivityTypes.Running],
    getActivityTypesAsString: () => activityType,
    getStat: (type: string) => type === DataDuration.type ? { getValue: () => 3600 } : null,
  } as unknown as EventInterface;
}
