import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { provideRouter } from '@angular/router';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { CalendarDayDetailsComponent, type CalendarDayDetailsData } from './calendar-day-details.component';

describe('CalendarDayDetailsComponent', () => {
  it('shows family totals and event detail links', async () => {
    const event = createEvent();
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
    const dismiss = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CalendarDayDetailsComponent],
      providers: [
        provideRouter([]),
        { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
        { provide: MatBottomSheetRef, useValue: { dismiss } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CalendarDayDetailsComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Running');
    expect(fixture.nativeElement.textContent).toContain('Morning run');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/user/user-1/event/event-1');
  });
});

function createEvent(): EventInterface {
  return {
    name: 'Morning run',
    startDate: new Date(2026, 7, 3, 8, 30),
    getID: () => 'event-1',
    getActivityTypesAsArray: () => [ActivityTypes.Running],
    getActivityTypesAsString: () => 'Running',
    getStat: (type: string) => type === DataDuration.type ? { getValue: () => 3600 } : null,
  } as unknown as EventInterface;
}
