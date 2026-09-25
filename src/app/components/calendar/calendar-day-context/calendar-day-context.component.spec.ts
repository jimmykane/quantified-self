import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { vi, expect, it, describe } from 'vitest';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { AppUserService } from '../../../services/app.user.service';
import { CalendarDayHealthService } from '../../../services/calendar-day-health.service';
import { TrainingWorkoutDuplicateService } from '../../../services/training-workout-duplicate.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';
import { CalendarDayContextComponent } from './calendar-day-context.component';

function data(dateKey: string): CalendarDayDetailsData {
  const model = buildActivityCalendarViewModel([], { view: 'month', anchorDate: new Date(`${dateKey}T12:00:00`), locale: 'en-US' });
  return { day: model.months[0].days.find(day => day.dateKey === dateKey)!, userId: 'owner', locale: 'en-US' };
}

const emptyEvidence = { sessions: [], hrvSeries: [], derived: null, sleepError: false, hrvError: false, readinessError: false, recoveryError: false };

describe('CalendarDayContextComponent', () => {
  it('keeps the calendar mounted, cancels an older day read, and fences private health on account change', async () => {
    const viewer = signal<{ uid: string } | null>({ uid: 'owner' });
    const pending: Array<Subject<typeof emptyEvidence>> = [];
    const watch = vi.fn((_uid, _date, _now, _signal) => {
      const subject = new Subject<typeof emptyEvidence>();
      pending.push(subject);
      return subject.asObservable();
    });
    await TestBed.configureTestingModule({ imports: [CalendarDayContextComponent], providers: [
      provideRouter([]),
      { provide: AppUserService, useValue: { user: viewer } },
      { provide: CalendarDayHealthService, useValue: { watch } },
      { provide: TrainingWorkoutDuplicateService, useValue: { duplicate: vi.fn() } },
      { provide: AppEventColorService, useValue: { getActivityColor: vi.fn(), getColorForActivityTypeByActivityTypeGroup: vi.fn() } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(CalendarDayContextComponent);
    fixture.componentRef.setInput('data', data('2026-09-10'));
    fixture.componentRef.setInput('showFullDayLink', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.calendar-day-context-header a')?.getAttribute('href'))
      .toBe('/calendar/day/2026-09-10');
    expect(watch).toHaveBeenCalledWith('owner', '2026-09-10', expect.any(Number), expect.any(AbortSignal));
    const oldSignal = watch.mock.calls[0][3] as AbortSignal;
    fixture.componentRef.setInput('data', data('2026-09-11'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.calendar-day-context-header a')?.getAttribute('href'))
      .toBe('/calendar/day/2026-09-11');
    expect(oldSignal.aborted).toBe(true);
    expect(pending[0].observed).toBe(false);
    pending[0].next(emptyEvidence); fixture.detectChanges();
    expect(fixture.componentInstance.healthState().status).toBe('loading');
    pending[1].next(emptyEvidence); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No HRV reading for this day');
    pending[1].next({ ...emptyEvidence, sleepError: true }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sleep could not be loaded');
    fixture.componentRef.setInput('data', { ...data('2026-09-11'), userId: 'different-profile' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.calendar-day-context-health')).toBeNull();
    expect(watch).toHaveBeenCalledTimes(2);
    viewer.set({ uid: 'another' }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.calendar-day-context-health')).toBeNull();
    expect(watch).toHaveBeenCalledTimes(2);
    fixture.componentRef.setInput('privateHealthEnabled', false);
    viewer.set({ uid: 'owner' }); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(2);
  });
});
