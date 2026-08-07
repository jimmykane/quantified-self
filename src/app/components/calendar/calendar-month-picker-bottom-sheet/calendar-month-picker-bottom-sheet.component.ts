import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import type { User } from '@sports-alliance/sports-lib';
import { SharedModule } from '../../../modules/shared.module';
import { ActivityCalendarTileComponent } from '../activity-calendar-tile/activity-calendar-tile.component';

export interface CalendarMonthPickerBottomSheetData {
  user: User;
}

@Component({
  selector: 'app-calendar-month-picker-bottom-sheet',
  standalone: true,
  imports: [SharedModule, ActivityCalendarTileComponent],
  templateUrl: './calendar-month-picker-bottom-sheet.component.html',
  styleUrls: ['./calendar-month-picker-bottom-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarMonthPickerBottomSheetComponent {
  private readonly bottomSheetRef = inject(MatBottomSheetRef<CalendarMonthPickerBottomSheetComponent>);
  readonly data = inject<CalendarMonthPickerBottomSheetData>(MAT_BOTTOM_SHEET_DATA);

  dismiss(): void {
    this.bottomSheetRef.dismiss();
  }
}
