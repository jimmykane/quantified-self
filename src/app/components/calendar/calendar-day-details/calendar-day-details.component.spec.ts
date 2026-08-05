import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { provideRouter } from '@angular/router';
import {
  ActivityTypes,
  DataAscent,
  DataDescent,
  DataDistance,
  DataDuration,
  DaysOfTheWeek,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { CalendarDayDetailsComponent, type CalendarDayDetailsData } from './calendar-day-details.component';

describe('CalendarDayDetailsComponent', () => {
  it('shows family totals and event detail links', async () => {
    const fixture = await renderDayDetails(createEvent());

    expect(fixture.nativeElement.textContent).toContain('Running');
    expect(fixture.nativeElement.textContent).toContain('Morning run');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/user/user-1/event/event-1');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-copy strong')?.textContent?.trim()).toBe('Running');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-value')?.textContent?.trim()).toBe('1h');
    expect([...fixture.nativeElement.querySelectorAll('h3')].map((heading: HTMLElement) => heading.textContent?.trim()))
      .toEqual(['Activities', 'Activity details']);
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

  it('shows day and activity distance and descent while excluding downhill ascent', async () => {
    const fixture = await renderDayDetails(createEvent(
      'Downhill ride',
      undefined,
      'Downhill Cycling',
      {
        [DataDistance.type]: 20_000,
        [DataAscent.type]: 900,
        [DataDescent.type]: 1200,
      },
    ));

    const groupStats = [...fixture.nativeElement.querySelectorAll(
      '[aria-labelledby="calendar-day-family-title"] .calendar-family-volume-stat',
    )]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(groupStats).toEqual([
      'Duration 1h',
      'Distance 20.00 Km',
      'Descent 1,200 m',
    ]);
    const eventStats = [...fixture.nativeElement.querySelectorAll('.calendar-day-event-metrics .calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(eventStats).toEqual([
      'Distance 20.00 Km',
      'Descent 1,200 m',
    ]);
    const eventItem = fixture.nativeElement.querySelector('.calendar-day-event-item-with-metrics');
    expect(eventItem?.querySelector('.calendar-day-event-supporting .calendar-day-event-detail')?.textContent?.trim())
      .toBe('Downhill Cycling - 8:30 AM - 1h');
    expect(eventItem?.querySelector('.calendar-day-event-metrics')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-track')?.getAttribute('role'))
      .toBe('progressbar');
  });

  it('uses the shared bottom-sheet surface without an inset background', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-day-details/calendar-day-details.component.scss'),
      'utf8',
    );

    expect(styles).not.toMatch(/\.calendar-day-details\s*\{[^}]*\bbackground\s*:/s);
  });

  it('keeps the header outside the day-detail scroll region', () => {
    const componentStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-day-details/calendar-day-details.component.scss'),
      'utf8',
    );
    const globalStyles = readFileSync(resolve(process.cwd(), 'src/styles.scss'), 'utf8');

    expect(componentStyles).toMatch(/:host\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0/s);
    expect(componentStyles).toMatch(/\.calendar-day-details\s*\{[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
    expect(componentStyles).toMatch(/\.calendar-day-details-content\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
    expect(globalStyles).toMatch(/\.mat-bottom-sheet-container\s*\{[^}]*display:\s*flex !important/s);
  });

  it('uses a content-sized activity row for event metrics', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-day-details/calendar-day-details.component.scss'),
      'utf8',
    );

    expect(styles).toMatch(/\.calendar-day-event-item-with-metrics\s*\{[^}]*height:\s*auto[^}]*min-height:\s*88px/s);
    expect(styles).toMatch(/\.calendar-day-event-supporting\s*\{[^}]*display:\s*grid[^}]*overflow:\s*visible/s);
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
  metricOverrides: Partial<Record<string, number | null>> = {},
): EventInterface {
  const metrics: Record<string, number | null> = {
    [DataDuration.type]: 3600,
    ...metricOverrides,
  };
  return {
    name,
    description,
    startDate: new Date(2026, 7, 3, 8, 30),
    getID: () => 'event-1',
    getActivityTypesAsArray: () => [activityType === 'Downhill Cycling' ? ActivityTypes.DownhillCycling : ActivityTypes.Running],
    getActivityTypesAsString: () => activityType,
    getStat: (type: string) => {
      const value = metrics[type];
      return value === null || value === undefined ? null : { getValue: () => value };
    },
  } as unknown as EventInterface;
}
