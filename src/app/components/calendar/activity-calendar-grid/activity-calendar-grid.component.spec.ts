import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { By } from '@angular/platform-browser';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { ActivityCalendarGridComponent } from './activity-calendar-grid.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { TimelineNote } from '@shared/timeline-notes';
import { calendarTimelineNotesByDate } from '../../../helpers/calendar-timeline-notes.helper';
import type { PlannedWorkoutCalendarOverlay } from '../../../helpers/planned-workout-calendar.helper';

describe('ActivityCalendarGridComponent', () => {
  it.each(['week', 'month', 'year'] as const)('marks note-only days without activity markers in %s view', async view => {
    const fixture = await renderGrid(view, false, []);
    const note: TimelineNote = { id: 'a'.repeat(64), category: 'vacation', title: 'Vacation', startDate: '2026-08-03', endDate: '2026-08-03', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button').length).toBeGreaterThan(0);
    fixture.componentRef.setInput('timelineNotesByDate', calendarTimelineNotesByDate(fixture.componentInstance.model, [note]));
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[aria-label*="1 Timeline note"]') as HTMLButtonElement;
    expect(button.querySelector('.activity-calendar-note-indicator')?.textContent).toBe('beach_access');
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-note-indicator')).toHaveLength(1);
    expect(button.querySelector('.activity-calendar-note-colors')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelectorAll('.activity-calendar-note-color')).toHaveLength(1);
    expect((button.querySelector('.activity-calendar-note-color') as HTMLElement).style.backgroundColor).toBe('rgb(125, 125, 125)');
    expect((button.querySelector('.activity-calendar-note-indicator') as HTMLElement).style.color).toBe('rgb(125, 125, 125)');
    expect(button.querySelector('.activity-calendar-marker')).toBeNull();
    const selected = vi.fn(); fixture.componentInstance.daySelected.subscribe(selected);
    expect(fixture.componentRef.injector.get(AppHapticsService).selection).not.toHaveBeenCalled();
    button.click();
    expect(selected).toHaveBeenCalledOnce();
    expect(selected.mock.calls[0][0].eventCount).toBe(0);
    expect(fixture.componentRef.injector.get(AppHapticsService).selection).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('timelineNotesByDate', new Map()); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('.activity-calendar-note-colors')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-note-indicator')).toHaveLength(0);
  });
  it.each(['week', 'month', 'year'] as const)('shows every note colour on %s days without recolouring activity markers', async view => {
    const fixture = await renderGrid(view, false, [
      createEvent('run-1', new Date(2026, 7, 3, 8), ActivityTypes.Running, 3600),
    ]);
    const activityMarker = fixture.nativeElement.querySelector('.activity-calendar-marker') as HTMLElement;
    const originalMarkerStyle = activityMarker.getAttribute('style');
    const note: TimelineNote = { id: 'a'.repeat(64), category: 'travel', color: 'purple', title: 'Trip', startDate: '2026-08-03', endDate: '2026-08-03', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    fixture.componentRef.setInput('timelineNotesByDate', calendarTimelineNotesByDate(fixture.componentInstance.model, [note]));
    fixture.detectChanges();
    const icon = () => fixture.nativeElement.querySelector('.activity-calendar-note-indicator') as HTMLElement;
    expect(icon().textContent).toBe('flight');
    expect(icon().style.color).toBe('rgb(158, 108, 236)');
    const colors = () => [...fixture.nativeElement.querySelectorAll('.activity-calendar-note-color')]
      .map((element: HTMLElement) => element.style.backgroundColor);
    expect(colors()).toEqual(['rgb(158, 108, 236)']);
    fixture.componentRef.setInput('timelineNotesByDate', calendarTimelineNotesByDate(fixture.componentInstance.model, [note, { ...note, id: 'b'.repeat(64), color: 'blue' }]));
    fixture.detectChanges();
    expect(icon().textContent).toBe('event_note');
    expect(icon().style.color).toBe('rgb(125, 125, 125)');
    expect(colors()).toEqual(['rgb(158, 108, 236)', 'rgb(22, 180, 234)']);
    expect(activityMarker.getAttribute('style')).toBe(originalMarkerStyle);
  });

  it('renders every visible day as a button and emits activity and empty days', async () => {
    const fixture = await renderGrid('month', false, [
      createEvent('run-1', new Date(2026, 7, 3, 8), ActivityTypes.Running, 3600),
    ]);
    const selected = vi.fn();
    fixture.componentInstance.daySelected.subscribe(selected);
    const buttons = fixture.debugElement.queryAll(By.css('.activity-calendar-day-button'));
    const activityDayIndex = fixture.componentInstance.model.months[0].days
      .findIndex(day => day.dateKey === '2026-08-03');
    const emptyDayIndex = fixture.componentInstance.model.months[0].days
      .findIndex(day => day.dateKey === '2026-08-04');

    buttons[activityDayIndex].triggerEventHandler('click');
    buttons[emptyDayIndex].triggerEventHandler('click');

    expect(selected).toHaveBeenCalledTimes(2);
    expect(selected.mock.calls[0][0].dateKey).toBe('2026-08-03');
    expect(selected.mock.calls[1][0].dateKey).toBe('2026-08-04');
    expect(fixture.componentRef.injector.get(AppHapticsService).selection).toHaveBeenCalledTimes(2);
    expect(buttons).toHaveLength(42);
  });

  it.each([
    ['week', false, true], ['month', false, true], ['month', true, true], ['month', true, false], ['year', false, true],
  ] as const)('renders both plan colors in %s view (compact: %s, fill: %s) without changing activity markers', async (view, compact, fillHeight) => {
    const plannedWorkoutsByDate: PlannedWorkoutCalendarOverlay = {
      '2026-08-03': {
        entries: [],
        visibleEntries: [
          { workout: createWorkout('tempo', 'planned'), planName: 'Autumn build', color: 'purple' },
          { workout: createWorkout('rest', 'skipped'), planName: null, color: 'gray' },
        ],
        overflowCount: 1,
        hasSkipped: true,
        ariaLabel: '2 planned workouts, 1 skipped workout',
      },
    };
    const fixture = await renderGrid(view, compact, [
      createEvent('run-1', new Date(2026, 7, 3, 8), ActivityTypes.Running, 3600),
    ], DaysOfTheWeek.Monday, plannedWorkoutsByDate);
    fixture.componentRef.setInput('fillHeight', fillHeight); fixture.detectChanges();
    const plannedMarkers = fixture.nativeElement.querySelector('.planned-workout-markers');
    const activityMarkers = fixture.nativeElement.querySelectorAll('.activity-calendar-marker');

    expect(plannedMarkers.classList).toContain('planned-workout-markers--skipped');
    expect([...plannedMarkers.querySelectorAll('mat-icon')].map((icon: Element) => icon.textContent?.trim()))
      .toEqual(['event_note', 'event_busy']);
    expect(plannedMarkers.textContent).toContain('+1');
    expect([...plannedMarkers.querySelectorAll('mat-icon')].map((icon: HTMLElement) => icon.style.color)).toEqual(['purple', 'gray']);
    expect(plannedMarkers.querySelector('.planned-workout-marker--skipped')?.textContent).toBe('event_busy');
    expect(activityMarkers).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[aria-label*="2 planned workouts, 1 skipped workout"]'))
      .toBeTruthy();
    const originalActivityStyle = activityMarkers[0].getAttribute('style');
    const note: TimelineNote = { id: 'a'.repeat(64), category: 'vacation', color: 'purple', title: 'Vacation', startDate: '2026-08-03', endDate: '2026-08-03', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    fixture.componentRef.setInput('timelineNotesByDate', calendarTimelineNotesByDate(fixture.componentInstance.model, [note]));
    fixture.detectChanges();
    const combinedDay = fixture.nativeElement.querySelector('[aria-label*="1 Timeline note"]') as HTMLElement;
    expect(combinedDay.getAttribute('aria-label')).toContain('2 planned workouts, 1 skipped workout');
    expect(combinedDay.querySelector('.planned-workout-markers')).toBe(plannedMarkers);
    expect((combinedDay.querySelector('.activity-calendar-note-color') as HTMLElement).style.backgroundColor).toBe('rgb(158, 108, 236)');
    expect(combinedDay.querySelector('.activity-calendar-note-indicator')?.textContent).toBe('beach_access');
    expect(combinedDay.querySelector('.activity-calendar-marker')?.getAttribute('style')).toBe(originalActivityStyle);
  });

  it('renders same-center markers for compact calendars', async () => {
    const fixture = await renderGrid('month', true, [
      createEvent('run-1', new Date(2026, 7, 3, 8), ActivityTypes.Running, 3600),
      createEvent('ride-1', new Date(2026, 7, 3, 12), ActivityTypes.Cycling, 1800),
    ]);
    const stage = fixture.nativeElement.querySelector('.activity-calendar-marker-stage');
    const markers = [...stage.querySelectorAll('.activity-calendar-marker')] as HTMLElement[];

    expect(stage.classList).toContain('activity-calendar-marker-stage--concentric');
    expect(markers).toHaveLength(2);
    expect(markers[0].style.getPropertyValue('--calendar-marker-compact-diameter')).toMatch(/px$/);
    expect(markers[0].style.getPropertyValue('--calendar-marker-diameter')).toMatch(/px$/);
    expect(fixture.nativeElement.querySelector('.activity-calendar-month')?.classList)
      .not.toContain('qs-glass-card-panel');
  });

  it('opts only scrollable compact pickers out of height-filling without changing day selection', async () => {
    const fixture = await renderGrid('month', true, [
      createEvent('run-1', new Date(2026, 7, 3, 8), ActivityTypes.Running, 3600),
    ]);
    const grid = fixture.nativeElement.querySelector('.activity-calendar');
    expect(grid.classList).toContain('activity-calendar--fill-height');
    const markerStyle = fixture.nativeElement.querySelector('.activity-calendar-marker').getAttribute('style');
    const selected = vi.fn(); fixture.componentInstance.daySelected.subscribe(selected);
    fixture.componentRef.setInput('fillHeight', false); fixture.detectChanges();
    expect(grid.classList).not.toContain('activity-calendar--fill-height');
    expect(grid.classList).toContain('activity-calendar--compact');
    expect(fixture.nativeElement.querySelector('.activity-calendar-marker').getAttribute('style')).toBe(markerStyle);
    fixture.nativeElement.querySelector('[aria-label*="1 activity"]').click();
    expect(selected.mock.calls[0][0].dateKey).toBe('2026-08-03');
    expect(fixture.componentRef.injector.get(AppHapticsService).selection).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('fillHeight', true);
    fixture.componentRef.setInput('compact', false); fixture.detectChanges();
    expect(grid.classList).not.toContain('activity-calendar--fill-height');
  });

  it.each([
    [2026, 1, DaysOfTheWeek.Sunday, 28],
    [2027, 1, DaysOfTheWeek.Monday, 28],
    [2026, 8, DaysOfTheWeek.Monday, 35],
    [2026, 7, DaysOfTheWeek.Monday, 42],
    [2026, 7, DaysOfTheWeek.Sunday, 42],
  ])('shows only occupied weeks in the picker for %i/%i, week start %i', async (year, month, startOfWeek, count) => {
    const fixture = await renderGrid('month', true, []);
    const model = buildActivityCalendarViewModel([], {
      view: 'month', anchorDate: new Date(year, month, 1), startOfWeek, now: new Date(year, month, 1),
    });
    fixture.componentRef.setInput('model', model);
    fixture.componentRef.setInput('hideOutsideDays', true);
    fixture.componentRef.setInput('fillHeight', false);
    fixture.detectChanges();
    const days = [...fixture.nativeElement.querySelectorAll('.activity-calendar-day')] as HTMLElement[];
    expect(days).toHaveLength(count);
    // Leading blanks preserve weekday alignment; every real date remains selectable.
    const first = model.months[0].days.findIndex(day => day.inPrimaryPeriod);
    expect(days[first].textContent.trim()).toBe('1');
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button'))
      .toHaveLength(new Date(year, month + 1, 0).getDate());
    expect(model.months[0].days).toHaveLength(42);
    fixture.componentRef.setInput('fillHeight', true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day')).toHaveLength(42);
    expect(fixture.nativeElement.querySelector('.activity-calendar--picker')).toBeNull();
    fixture.componentRef.setInput('fillHeight', false);
    fixture.componentRef.setInput('hideOutsideDays', false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(42);
    fixture.componentRef.setInput('hideOutsideDays', true);
    fixture.componentRef.setInput('compact', false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day')).toHaveLength(42);
  });

  it('uses a separate right-edge color rail in compact cells without covering date, note, or activity icons', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.scss'), 'utf8');
    const rail = styles.match(/\.activity-calendar--compact \.planned-workout-markers\s*\{([^}]*)\}/)?.[1];
    expect(rail).toContain('top: 18px;');
    expect(rail).toContain('right: 2px;');
    expect(rail).toContain('bottom: 3px;');
    expect(rail).toContain('flex-direction: column;');
    expect(styles).toContain('border-inline-end: 3px solid currentColor;');
    expect(styles).toContain('border-inline-end-style: dashed;');
  });

  it('renders twelve glass month panels in yearly mode', async () => {
    const fixture = await renderGrid('year', false, []);
    const monthPanels = [...fixture.nativeElement.querySelectorAll('.activity-calendar-month')] as HTMLElement[];

    expect(monthPanels).toHaveLength(12);
    expect(monthPanels.every(panel => panel.classList.contains('qs-glass-card-panel'))).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-month h2')).toHaveLength(12);
    expect(fixture.nativeElement.querySelector('.activity-calendar')?.classList.contains('activity-calendar--year')).toBe(true);
  });

  it('marks the configured week start and actual weekend columns', async () => {
    const fixture = await renderGrid('month', false, [], DaysOfTheWeek.Sunday);
    const weekdays = [...fixture.nativeElement.querySelectorAll('.activity-calendar-weekdays span')] as HTMLElement[];
    const firstWeek = [...fixture.nativeElement.querySelectorAll('.activity-calendar-day')].slice(0, 7) as HTMLElement[];

    expect(weekdays.map(weekday => weekday.textContent?.trim())).toEqual([
      'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
    ]);
    expect(weekdays[0].classList).toContain('activity-calendar-weekday--week-start');
    expect(weekdays[0].classList).toContain('activity-calendar-weekday--weekend');
    expect(weekdays[6].classList).toContain('activity-calendar-weekday--weekend');
    expect(weekdays[1].classList).not.toContain('activity-calendar-weekday--weekend');
    expect(firstWeek[0].classList).toContain('activity-calendar-day--weekend');
    expect(firstWeek[6].classList).toContain('activity-calendar-day--weekend');
    expect(firstWeek[1].classList).not.toContain('activity-calendar-day--weekend');
  });

  it('does not use calendar-specific gray surface fills', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.scss'),
      'utf8',
    );

    expect(styles).not.toContain('surface-container-low');
    expect(styles).not.toContain('mat-sys-tertiary');
    expect(styles).toContain('var(--mat-sys-primary) var(--activity-calendar-weekend-tint)');
    expect(styles).not.toMatch(/\.activity-calendar-weekday--weekend\s*{\s*background:/);
  });

  it('centers the current-day number within a fixed marker', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.scss'),
      'utf8',
    );
    const numberRule = styles.match(/\.activity-calendar-day-number\s*\{([^}]*)\}/)?.[1];
    const todayRule = styles.match(/\.activity-calendar-day--today \.activity-calendar-day-number\s*\{([^}]*)\}/)?.[1];
    const todayNumberValueRule = styles.match(
      /\.activity-calendar-day--today \.activity-calendar-day-number-value\s*\{([^}]*)\}/,
    )?.[1];

    expect(numberRule).toContain('display: inline-flex;');
    expect(numberRule).toContain('align-items: center;');
    expect(numberRule).toContain('justify-content: center;');
    expect(numberRule).toContain('padding: 0;');
    expect(numberRule).toContain('font-variant-numeric: tabular-nums;');
    expect(todayNumberValueRule).toContain('transform: translateX(-0.5px);');
    expect(todayRule).not.toMatch(/transform:/);
  });

  it('keeps compact and yearly current-day markers square', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.scss'),
      'utf8',
    );
    const compactNumberRule = styles.match(
      /\.activity-calendar--year \.activity-calendar-day-number,\s*\.activity-calendar--compact \.activity-calendar-day-number\s*\{([^}]*)\}/,
    )?.[1];

    expect(compactNumberRule).toContain('width: 18px;');
    expect(compactNumberRule).toContain('height: 18px;');
    expect(compactNumberRule).toContain('flex-basis: 18px;');
  });

  it('keeps compact family-overflow labels inside the day marker', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.scss'),
      'utf8',
    );
    const overflowRule = styles.match(
      /\.activity-calendar--year \.activity-calendar-marker-overflow,\s*\.activity-calendar--compact \.activity-calendar-marker-overflow\s*\{([^}]*)\}/,
    )?.[1];

    expect(overflowRule).toContain('right: 0;');
    expect(overflowRule).toContain('bottom: 0;');
    expect(overflowRule).toContain('z-index: 4;');
    expect(overflowRule).toContain('background: var(--mat-sys-surface);');
    expect(overflowRule).not.toContain('right: -5px;');
  });

  it('gives compact markers vertical clearance between adjacent calendar rows', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.scss'),
      'utf8',
    );
    const compactStageRule = styles.match(
      /\.activity-calendar--compact \.activity-calendar-marker-stage\s*\{([^}]*)\}/,
    )?.[1];

    expect(compactStageRule).toContain('height: 20px;');
    expect(compactStageRule).toContain('flex: 0 0 20px;');
  });

  it('fits all six compact calendar weeks inside the available mobile tile height', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.scss'),
      'utf8',
    );
    const mobileStyles = styles.match(/@media \(max-width: 860px\)\s*\{([\s\S]*)\}\s*@media \(prefers-reduced-motion:/)?.[1];

    expect(mobileStyles).not.toContain('.activity-calendar--compact');
    expect(mobileStyles).toMatch(
      /\.activity-calendar--fill-height \.activity-calendar-days\s*\{[^}]*min-height:\s*0;[^}]*grid-template-rows:\s*repeat\(6, minmax\(0, 1fr\)\);/s,
    );
    expect(mobileStyles).toMatch(
      /\.activity-calendar--fill-height \.activity-calendar-day\s*\{[^}]*min-height:\s*0;[^}]*padding-block:\s*0;/s,
    );
  });

  it('keeps activity days free of tooltips so touch scrolling remains native', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-grid/activity-calendar-grid.component.html'),
      'utf8',
    );

    expect(template).not.toContain('matTooltip');
    expect(template).not.toContain('[attr.title]');
  });
});

async function renderGrid(
  view: 'week' | 'month' | 'year',
  compact: boolean,
  events: EventInterface[],
  startOfWeek: DaysOfTheWeek | number = DaysOfTheWeek.Monday,
  plannedWorkoutsByDate: PlannedWorkoutCalendarOverlay = {},
) {
  const fixture = await import('@angular/core/testing').then(async ({ TestBed }) => {
    await TestBed.configureTestingModule({
      imports: [ActivityCalendarGridComponent],
      providers: [{
        provide: AppHapticsService,
        useValue: {
          selection: vi.fn(),
          success: vi.fn(),
          warning: vi.fn(),
          error: vi.fn(),
        },
      }],
    }).compileComponents();
    return TestBed.createComponent(ActivityCalendarGridComponent);
  });
  fixture.componentRef.setInput('model', buildActivityCalendarViewModel(events, {
    view,
    anchorDate: new Date(2026, 7, 3),
    startOfWeek,
    locale: 'en-US',
    now: new Date(2026, 7, 3),
  }));
  fixture.componentRef.setInput('compact', compact);
  fixture.componentRef.setInput('plannedWorkoutsByDate', plannedWorkoutsByDate);
  fixture.detectChanges();
  return fixture;
}

function createWorkout(id: string, lifecycle: 'planned' | 'skipped') {
  return {
    schemaVersion: 1 as const,
    id,
    planId: id === 'tempo' ? 'plan-1' : null,
    localDate: '2026-08-03',
    lifecycle,
    title: id,
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
  id: string,
  startDate: Date,
  activityType: ActivityTypes,
  durationSeconds: number,
): EventInterface {
  return {
    startDate,
    getID: () => id,
    getActivityTypesAsArray: () => [activityType],
    getActivityTypesAsString: () => activityType,
    getStat: (type: string) => type === DataDuration.type ? { getValue: () => durationSeconds } : null,
  } as unknown as EventInterface;
}
