import { signal } from '@angular/core';
import { AppThemes, DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { TestBed } from '@angular/core/testing';
import { ViewportScroller } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { vi, expect, it, describe } from 'vitest';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { AppUserService } from '../../../services/app.user.service';
import { CalendarDayHealthService } from '../../../services/calendar-day-health.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { TrainingWorkoutDuplicateService } from '../../../services/training-workout-duplicate.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
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
      { provide: ViewportScroller, useValue: { scrollToAnchor: vi.fn() } },
      { provide: AppUserService, useValue: { user: viewer } },
      { provide: CalendarDayHealthService, useValue: { watch } },
      { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Dark) } },
      { provide: EChartsLoaderService, useValue: { init: vi.fn().mockResolvedValue(null), dispose: vi.fn() } },
      { provide: LoggerService, useValue: { error: vi.fn() } },
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
    expect(fixture.nativeElement.querySelector('app-health-sleep-stage-summary')).toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-day-context-timeline')).toBeNull();
    fixture.componentRef.setInput('standaloneDayPage', true);
    pending[1].next({ ...emptyEvidence, sessions: [{
      id: 'night', sleepDate: '2026-09-11', startTimeMs: new Date(2026, 8, 10, 23).getTime(),
      endTimeMs: new Date(2026, 8, 11, 7).getTime(), durationSeconds: 8 * 3600,
      score: { value: 74 }, stageDurationsSeconds: { deep: 7200, light: 14_400, rem: 5400, awake: 1800 },
      source: { provider: 'SuuntoApp' },
    }] } as typeof emptyEvidence); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-health-sleep-stage-summary')?.textContent).toContain('Sleep stages');
    expect(fixture.nativeElement.querySelector('.calendar-day-context-sleep-stages')?.textContent).toContain('Suunto · overnight sleep');
    expect(fixture.nativeElement.querySelector('.calendar-day-context-timeline')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Activities on selected day"]')).toBeNull();
    const scrollToAnchor = vi.spyOn(TestBed.inject(ViewportScroller), 'scrollToAnchor');
    fixture.nativeElement.querySelector('.calendar-day-timeline-content button')?.click();
    expect(scrollToAnchor).toHaveBeenCalledWith('day-sleep-stages');
    expect(fixture.componentInstance.healthState().sleepPoint?.sleepDate).toBe('2026-09-11');
    for (const unitSettings of [null, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })]) {
      fixture.componentRef.setInput('data', { ...data('2026-09-11'), unitSettings });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.sleep-stage-legend')?.textContent).toContain('Deep02h 00m');
    }
    pending[1].next({ ...emptyEvidence, sleepError: true }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sleep could not be loaded');
    expect(fixture.nativeElement.querySelector('app-health-sleep-stage-summary')).toBeNull();
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
