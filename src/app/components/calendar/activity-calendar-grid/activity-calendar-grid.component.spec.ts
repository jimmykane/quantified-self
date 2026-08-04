import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { By } from '@angular/platform-browser';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { ActivityCalendarGridComponent } from './activity-calendar-grid.component';

describe('ActivityCalendarGridComponent', () => {
  it('renders activity days as buttons and emits the selected day', async () => {
    const fixture = await renderGrid('month', false, [
      createEvent('run-1', new Date(2026, 7, 3, 8), ActivityTypes.Running, 3600),
    ]);
    const selected = vi.fn();
    fixture.componentInstance.daySelected.subscribe(selected);
    const activeDay = fixture.debugElement.query(By.css('.activity-calendar-day-button'));

    activeDay.triggerEventHandler('click');

    expect(selected).toHaveBeenCalledOnce();
    expect(selected.mock.calls[0][0].dateKey).toBe('2026-08-03');
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(1);
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
) {
  const fixture = await import('@angular/core/testing').then(async ({ TestBed }) => {
    await TestBed.configureTestingModule({ imports: [ActivityCalendarGridComponent] }).compileComponents();
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
  fixture.detectChanges();
  return fixture;
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
