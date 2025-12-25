import { Component, Inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { EventInterface, ActivityInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-event-stats-bottom-sheet',
    templateUrl: './event-stats-bottom-sheet.component.html',
    styleUrls: ['./event-stats-bottom-sheet.component.css'],
    standalone: false
})
export class EventStatsBottomSheetComponent {
    constructor(
        @Inject(MAT_BOTTOM_SHEET_DATA) public data: {
            event: EventInterface,
            selectedActivities: ActivityInterface[],
            userUnitSettings: UserUnitSettingsInterface
        },
        private bottomSheetRef: MatBottomSheetRef<EventStatsBottomSheetComponent>
    ) { }

    close(): void {
        this.bottomSheetRef.dismiss();
    }
}
