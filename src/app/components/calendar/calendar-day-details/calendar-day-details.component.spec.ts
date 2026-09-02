import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@angular/core';
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
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import type { PlannedWorkoutCalendarEntry } from '../../../helpers/planned-workout-calendar.helper';
import { CalendarDayDetailsComponent, type CalendarDayDetailsData } from './calendar-day-details.component';

describe('CalendarDayDetailsComponent', () => {
  it('shows family totals and event detail links', async () => {
    const fixture = await renderDayDetails(createEvent());

    expect(fixture.nativeElement.textContent).toContain('Running');
    expect(fixture.nativeElement.textContent).toContain('Morning run');
    expect(fixture.nativeElement.querySelector('.calendar-day-event-item')?.getAttribute('href'))
      .toBe('/user/user-1/event/event-1');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-copy strong')?.textContent?.trim()).toBe('Running');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-value')?.textContent?.trim()).toBe('1h');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-row--link')?.getAttribute('href'))
      .toBe('/user/user-1/event/event-1');
    expect(fixture.nativeElement.querySelector('.calendar-day-number')?.textContent?.trim()).toBe('1');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-count-value')?.textContent?.trim()).toBe('1');
    expect(fixture.nativeElement.querySelector('app-bottom-sheet-header h2')?.textContent?.trim())
      .toBe('Monday, August 3, 2026');
    expect(fixture.nativeElement.querySelectorAll('.bottom-sheet-title-numeric')).toHaveLength(0);
    expect([...fixture.nativeElement.querySelectorAll('.calendar-day-event-metric')]
      .map((part: HTMLElement) => part.textContent?.trim())).toEqual(['8:30 AM', '1h']);
    expect([...fixture.nativeElement.querySelectorAll('h3')].map((heading: HTMLElement) => heading.textContent?.trim()))
      .toEqual(['Planned workouts', 'Completed activities', 'Completed activity details']);
  });

  it('keeps planned workouts separate and offers active-plan and standalone add paths', async () => {
    const fixture = await renderDayDetails([], [{
      workout: createPlannedWorkout(),
      planName: 'Autumn build',
    }]);
    const actions = [...fixture.nativeElement.querySelectorAll('.calendar-day-plan-actions a')] as HTMLAnchorElement[];

    expect(fixture.nativeElement.querySelector('.calendar-day-planned-item')?.getAttribute('href'))
      .toBe('/plans?workout=workout-1');
    expect(fixture.nativeElement.querySelector('.calendar-day-planned-item')?.textContent)
      .toContain('Autumn build · Planned');
    expect(fixture.nativeElement.querySelector('.calendar-day-planned-summary')?.textContent).toContain('30m 00s');
    expect(actions.map(action => action.getAttribute('href'))).toEqual([
      '/plans?date=2026-08-03',
      '/plans?date=2026-08-03&scope=standalone',
    ]);
    expect(fixture.nativeElement.textContent).toContain('No completed activities for this day.');
    expect(fixture.nativeElement.querySelector('[aria-labelledby="calendar-day-family-title"]')).toBeNull();
  });

  it('updates an already-open day when the planned-workout listener finishes', async () => {
    const status = signal<'loading' | 'ready' | 'error'>('loading');
    const planned = signal<PlannedWorkoutCalendarEntry[]>([]);
    const fixture = await renderDayDetails([], [], {
      plannedWorkoutsSource: () => planned(),
      plannedWorkoutsStatusSource: () => status(),
    });

    expect(fixture.nativeElement.textContent).toContain('Loading planned workouts');

    planned.set([{ workout: createPlannedWorkout(), planName: 'Autumn build' }]);
    status.set('ready');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.calendar-day-planned-item')?.textContent)
      .toContain('Autumn build · Planned');
    expect(fixture.nativeElement.textContent).not.toContain('Loading planned workouts');
  });

  it('uses Barlow Condensed only for numeric day-detail content, not the date title', () => {
    const detailsStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-day-details/calendar-day-details.component.scss'),
      'utf8',
    );
    const listStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-volume-list/activity-calendar-volume-list.component.scss'),
      'utf8',
    );
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-day-details/calendar-day-details.component.html'),
      'utf8',
    );

    expect(detailsStyles).toMatch(
      /\.calendar-day-number,\s*\.calendar-day-event-metric\s*\{[^}]*font-family:\s*'Barlow Condensed', sans-serif/s,
    );
    expect(listStyles).toMatch(
      /\.calendar-family-volume-count-value\s*\{[^}]*font-family:\s*'Barlow Condensed', sans-serif/s,
    );
    expect(template).toContain('<app-bottom-sheet-header [title]="title" icon="calendar_month">');
    expect(template).not.toContain('[titleSegments]');
  });

  it('keeps a family summary non-clickable when it contains multiple events', async () => {
    const fixture = await renderDayDetails([
      createEvent('Morning run', undefined, 'Running', {}, 'event-1'),
      createEvent('Evening run', undefined, 'Running', {}, 'event-2'),
    ]);

    expect(fixture.componentInstance.familyVolumeRows[0].route).toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-row--link')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.calendar-day-event-item')).toHaveLength(2);
  });

  it('records the calendar day before opening an event and dismisses the sheet', async () => {
    const fixture = await renderDayDetails(createEvent());
    const navigation = TestBed.inject(CalendarDayDetailsNavigationService);
    const bottomSheetRef = TestBed.inject(MatBottomSheetRef);
    const prepareReturn = vi.spyOn(navigation, 'prepareReturn');

    fixture.componentInstance.prepareEventNavigation(['/user', 'user-1', 'event', 'event-1']);

    expect(prepareReturn).toHaveBeenCalledWith('/', '2026-08-03');
    expect(bottomSheetRef.dismiss).toHaveBeenCalledOnce();
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
    expect(componentStyles).toMatch(/:host\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden/s);
    expect(componentStyles).toMatch(/\.calendar-day-details\s*\{[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
    expect(componentStyles).toMatch(/\.calendar-day-details-content\s*\{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto[^}]*overscroll-behavior-x:\s*none[^}]*touch-action:\s*pan-y/s);
    expect(componentStyles).toMatch(/\.calendar-day-details-content > \*\s*\{[^}]*min-width:\s*0/s);
    expect(globalStyles).toMatch(/\.mat-bottom-sheet-container\s*\{[^}]*display:\s*flex !important/s);
  });

  it('uses a content-sized activity row for event metrics', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-day-details/calendar-day-details.component.scss'),
      'utf8',
    );

    expect(styles).toMatch(/\.calendar-day-event-item-with-metrics\s*\{[^}]*height:\s*auto[^}]*min-height:\s*88px/s);
    expect(styles).toMatch(
      /\.calendar-day-event-item-with-metrics \.calendar-day-event-icon\s*\{[^}]*align-self:\s*center !important[^}]*margin-top:\s*0 !important/s,
    );
    expect(styles).toMatch(/\.calendar-day-event-supporting\s*\{[^}]*display:\s*grid[^}]*overflow:\s*visible/s);
    expect(styles).toMatch(/\.calendar-day-event-metrics\s*\{[^}]*--calendar-volume-stats-column-gap:\s*8px/s);
  });
});

async function renderDayDetails(
  eventOrEvents: EventInterface | EventInterface[],
  plannedWorkouts: PlannedWorkoutCalendarEntry[] = [],
  overrides: Partial<CalendarDayDetailsData> = {},
) {
  const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
  const model = buildActivityCalendarViewModel(events, {
    view: 'month',
    anchorDate: new Date(2026, 7, 3),
    startOfWeek: DaysOfTheWeek.Monday,
    locale: 'en-US',
  });
  const data: CalendarDayDetailsData = {
    day: model.months[0].days.find(day => day.dateKey === '2026-08-03'),
    userId: 'user-1',
    locale: 'en-US',
    plannedWorkouts,
    ...overrides,
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

function createPlannedWorkout() {
  return {
    schemaVersion: 1 as const,
    id: 'workout-1',
    planId: 'plan-1',
    localDate: '2026-08-03',
    lifecycle: 'planned' as const,
    title: 'Tempo intervals',
    structure: {
      version: 1 as const,
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'step' as const,
        id: 'steady',
        purpose: 'work' as const,
        ending: { kind: 'time' as const, seconds: 1800 },
        targets: [],
      }],
    },
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function createEvent(
  name = 'Morning run',
  description?: string,
  activityType = 'Running',
  metricOverrides: Partial<Record<string, number | null>> = {},
  eventId = 'event-1',
): EventInterface {
  const metrics: Record<string, number | null> = {
    [DataDuration.type]: 3600,
    ...metricOverrides,
  };
  return {
    name,
    description,
    startDate: new Date(2026, 7, 3, 8, 30),
    getID: () => eventId,
    getActivityTypesAsArray: () => [activityType === 'Downhill Cycling' ? ActivityTypes.DownhillCycling : ActivityTypes.Running],
    getActivityTypesAsString: () => activityType,
    getStat: (type: string) => {
      const value = metrics[type];
      return value === null || value === undefined ? null : { getValue: () => value };
    },
  } as unknown as EventInterface;
}
