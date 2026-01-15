import { Component, Inject, OnInit } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../../../services/app.event.service';
import { DataFeeling, DataRPE, EventInterface, Feelings, isNumber, RPEBorgCR10SCale, User } from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { EnumeratorHelpers } from '../../../helpers/enumerator-helpers';
import { AppEventInterface } from '../../../../../functions/src/shared/app-event.interface';

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
    serviceName: ServiceNames | null = null;
    serviceLogo: string | null = null;

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

        this.eventService.getEventMetaDataKeys(this.user, this.event.getID()!).subscribe(keys => {
            if (keys && keys.length > 0) {
                // Check for known services
                if (keys.includes(ServiceNames.COROSAPI)) {
                    this.serviceName = ServiceNames.COROSAPI;
                } else if (keys.includes(ServiceNames.SuuntoApp)) {
                    this.serviceName = ServiceNames.SuuntoApp;
                } else if (keys.includes(ServiceNames.GarminAPI)) {
                    this.serviceName = ServiceNames.GarminAPI;
                }

                if (this.serviceName) {
                    this.serviceLogo = this.getServiceLogo(this.serviceName);
                }
            }
        });
    }

    returnZero() {
        return 0;
    }

    close() {
        this._bottomSheetRef.dismiss();
    }

    async saveEventName() {
        // Optimistic update already happened via ngModel
        await this.eventService.updateEventProperties(this.user, this.event.getID()!, {
            name: this.event.name,
        });
        this.snackBar.open('Event name saved', undefined, { duration: 2000 });
    }

    async saveEventDescription() {
        await this.eventService.updateEventProperties(this.user, this.event.getID()!, {
            description: this.event.description,
        });
        this.snackBar.open('Description saved', undefined, { duration: 2000 });
    }

    async saveEventFeeling() {
        if (!isNumber(this.feeling)) return;
        this.event.addStat(new DataFeeling(this.feeling));
        await this.eventService.writeAllEventData(this.user, this.event);
        this.snackBar.open('Feeling saved', undefined, { duration: 2000 });
    }

    async saveEventRPE() {
        if (!isNumber(this.rpe)) return;
        this.event.addStat(new DataRPE(this.rpe));
        await this.eventService.writeAllEventData(this.user, this.event);
        this.snackBar.open('RPE saved', undefined, { duration: 2000 });
    }

    private getServiceLogo(serviceName: ServiceNames): string {
        switch (serviceName) {
            case ServiceNames.COROSAPI:
                return 'assets/logos/coros.svg';
            case ServiceNames.SuuntoApp:
                return 'assets/logos/suunto-logo.svg';
            case ServiceNames.GarminAPI:
                return 'assets/logos/garmin.svg';
            default:
                return '';
        }
    }
}
