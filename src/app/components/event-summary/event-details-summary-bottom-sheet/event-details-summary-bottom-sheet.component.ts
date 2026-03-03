import { Component, Inject, OnInit } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../../../services/app.event.service';
import { DataFeeling, DataRPE, EventInterface, Feelings, isNumber, RPEBorgCR10SCale, User } from '@sports-alliance/sports-lib';
import { EnumeratorHelpers } from '../../../helpers/enumerator-helpers';

@Component({
    selector: 'app-event-details-summary-bottom-sheet',
    templateUrl: './event-details-summary-bottom-sheet.component.html',
    styleUrls: ['./event-details-summary-bottom-sheet.component.css'],
    standalone: false
})
export class EventDetailsSummaryBottomSheetComponent implements OnInit {
    event: EventInterface;
    user: User;

    feeling!: Feelings;
    rpe!: RPEBorgCR10SCale;
    feelings = EnumeratorHelpers.getNumericEnumKeyValue(Feelings);
    rpeBorgCR10SCale = EnumeratorHelpers.getNumericEnumKeyValue(RPEBorgCR10SCale);

    constructor(
        @Inject(MAT_BOTTOM_SHEET_DATA) public data: { event: EventInterface, user: User },
        private _bottomSheetRef: MatBottomSheetRef<EventDetailsSummaryBottomSheetComponent>,
        private eventService: AppEventService,
        private snackBar: MatSnackBar
    ) {
        this.event = data.event;
        this.user = data.user;
    }

    ngOnInit(): void {
        if (this.event.getStat(DataFeeling.type)) {
            this.feeling = (<DataFeeling>this.event.getStat(DataFeeling.type)).getValue();
        }
        if (this.event.getStat(DataRPE.type)) {
            this.rpe = (<DataRPE>this.event.getStat(DataRPE.type)).getValue();
        }
    }

    returnZero() {
        return 0;
    }

    close() {
        this._bottomSheetRef.dismiss();
    }

    async saveEventName() {
        const eventID = this.event.getID();
        if (!eventID) {
            return;
        }
        // Optimistic update already happened via ngModel
        await this.eventService.updateEventProperties(this.user, eventID, {
            name: this.event.name,
        });
        this.snackBar.open('Event name saved', undefined, { duration: 2000 });
    }

    async saveEventDescription() {
        const eventID = this.event.getID();
        if (!eventID) {
            return;
        }
        await this.eventService.updateEventProperties(this.user, eventID, {
            description: this.event.description,
        });
        this.snackBar.open('Description saved', undefined, { duration: 2000 });
    }

    async saveEventFeeling() {
        const eventID = this.event.getID();
        if (!eventID || !isNumber(this.feeling)) {
            return;
        }
        this.event.addStat(new DataFeeling(this.feeling));
        const eventJSON = this.event.toJSON();
        await this.eventService.updateEventProperties(this.user, eventID, {
            stats: eventJSON.stats,
        });
        this.snackBar.open('Feeling saved', undefined, { duration: 2000 });
    }

    async saveEventRPE() {
        const eventID = this.event.getID();
        if (!eventID || !isNumber(this.rpe)) {
            return;
        }
        this.event.addStat(new DataRPE(this.rpe));
        const eventJSON = this.event.toJSON();
        await this.eventService.updateEventProperties(this.user, eventID, {
            stats: eventJSON.stats,
        });
        this.snackBar.open('RPE saved', undefined, { duration: 2000 });
    }
}
