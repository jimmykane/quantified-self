import { TestBed } from '@angular/core/testing';
import { DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import dayjs from 'dayjs';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingWorkoutDuplicateDialogComponent, duplicateWorkoutLocalDate,
  type TrainingWorkoutDuplicateDialogData } from './training-workout-duplicate-dialog.component';

describe('TrainingWorkoutDuplicateDialogComponent', () => {
  const data: TrainingWorkoutDuplicateDialogData = { title: 'Long ride', scopeName: 'Winter',
    localDate: '2026-12-31', startOfWeek: 6,
    planRange: { startLocalDate: '2026-12-01', endLocalDate: '2026-12-31' } };
  const close = vi.fn();

  beforeEach(async () => {
    close.mockReset();
    await TestBed.configureTestingModule({ imports: [TrainingWorkoutDuplicateDialogComponent], providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DATE_LOCALE, useValue: 'en-GB' },
      { provide: AppHapticsService, useValue: { selection: vi.fn() } },
    ] }).compileComponents();
  });

  it('uses the saved local date, owner week start, and warns about extending the plan', () => {
    const fixture = TestBed.createComponent(TrainingWorkoutDuplicateDialogComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.localDate).toBe('2026-12-31');
    expect(fixture.debugElement.injector.get(DateAdapter).getFirstDayOfWeek()).toBe(6);
    expect(fixture.nativeElement.textContent).toContain('Long ride');
    fixture.componentInstance.setDate(dayjs('2027-01-02'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('asked to extend its dates');
    fixture.componentInstance.confirm();
    expect(close).toHaveBeenCalledWith('2027-01-02');
  });

  it('does not confirm invalid or cleared dates', () => {
    const fixture = TestBed.createComponent(TrainingWorkoutDuplicateDialogComponent);
    fixture.componentInstance.setDate(null);
    fixture.componentInstance.confirm();
    expect(close).not.toHaveBeenCalled();
    expect(duplicateWorkoutLocalDate(dayjs('invalid'))).toBeNull();
  });
});
