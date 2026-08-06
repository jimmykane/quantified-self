import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { of } from 'rxjs';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import {
  CalendarMonthPickerBottomSheetComponent,
  type CalendarMonthPickerBottomSheetData,
} from './calendar-month-picker-bottom-sheet.component';

describe('CalendarMonthPickerBottomSheetComponent', () => {
  const data: CalendarMonthPickerBottomSheetData = {
    user: { uid: 'user-1', settings: { unitSettings: {} } } as CalendarMonthPickerBottomSheetData['user'],
  };

  it('shows a pageable month grid with a stable header', async () => {
    const dismiss = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CalendarMonthPickerBottomSheetComponent],
      providers: [
        { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
        { provide: MatBottomSheetRef, useValue: { dismiss } },
        { provide: MatBottomSheet, useValue: { open: vi.fn() } },
        { provide: ActivityCalendarService, useValue: { watchEvents: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CalendarMonthPickerBottomSheetComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-bottom-sheet-header')?.textContent).toContain('Calendar');
    expect(fixture.nativeElement.querySelector('.activity-calendar-tile-navigation')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Previous month"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Next month"]')).not.toBeNull();

    (fixture.nativeElement.querySelector('[aria-label="Close calendar"]') as HTMLButtonElement).click();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('keeps its header outside the scrollable month grid', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/calendar-month-picker-bottom-sheet/calendar-month-picker-bottom-sheet.component.scss'),
      'utf8',
    );

    expect(styles).toMatch(/:host\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0/s);
    expect(styles).toMatch(/\.calendar-month-picker-bottom-sheet\s*\{[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.calendar-month-picker-content\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
    expect(styles).toMatch(/@media \(max-width: 959\.98px\)\s*\{[^}]*\.calendar-month-picker-content\s*\{[^}]*padding:\s*8px;/s);
  });
});
