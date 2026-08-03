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
  });

  it('renders twelve compact month panels in yearly mode', async () => {
    const fixture = await renderGrid('year', false, []);

    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-month')).toHaveLength(12);
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-month h2')).toHaveLength(12);
    expect(fixture.nativeElement.querySelector('.activity-calendar')?.classList.contains('activity-calendar--year')).toBe(true);
  });
});

async function renderGrid(
  view: 'week' | 'month' | 'year',
  compact: boolean,
  events: EventInterface[],
) {
  const fixture = await import('@angular/core/testing').then(async ({ TestBed }) => {
    await TestBed.configureTestingModule({ imports: [ActivityCalendarGridComponent] }).compileComponents();
    return TestBed.createComponent(ActivityCalendarGridComponent);
  });
  fixture.componentRef.setInput('model', buildActivityCalendarViewModel(events, {
    view,
    anchorDate: new Date(2026, 7, 3),
    startOfWeek: DaysOfTheWeek.Monday,
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
