import { Component, Inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { EventInterface, ActivityInterface } from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-event-devices-bottom-sheet',
    templateUrl: './event-devices-bottom-sheet.component.html',
    styleUrls: ['./event-devices-bottom-sheet.component.css'],
    standalone: false
})
export class EventDevicesBottomSheetComponent {
    constructor(
        @Inject(MAT_BOTTOM_SHEET_DATA) public data: {
            event: EventInterface,
            selectedActivities: ActivityInterface[]
        },
        private bottomSheetRef: MatBottomSheetRef<EventDevicesBottomSheetComponent>
    ) { }

    close(): void {
        this.bottomSheetRef.dismiss();
    }
}
