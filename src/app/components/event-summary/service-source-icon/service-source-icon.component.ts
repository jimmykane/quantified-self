import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { EventInterface, ServiceNames, User } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppEventService } from '../../../services/app.event.service';

@Component({
    selector: 'app-service-source-icon',
    templateUrl: './service-source-icon.component.html',
    styleUrls: ['./service-source-icon.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ServiceSourceIconComponent implements OnChanges, OnDestroy {
    @Input() event!: EventInterface;
    @Input() user!: User;

    serviceName: ServiceNames | null = null;
    serviceLogo: string | null = null;
    private metadataKeysSubscription?: Subscription;

    constructor(private eventService: AppEventService, private cd: ChangeDetectorRef) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['event'] || changes['user']) {
            this.checkServiceSource();
        }
    }

    private checkServiceSource() {
        this.metadataKeysSubscription?.unsubscribe();

        if (!this.user || !this.event || !this.event.getID()) {
            this.serviceName = null;
            this.serviceLogo = null;
            this.cd.markForCheck();
            return;
        }
        this.metadataKeysSubscription = this.eventService.getEventMetaDataKeys(this.user, this.event.getID()!)
            .pipe(take(1))
            .subscribe(keys => {
                if (keys?.includes(ServiceNames.COROSAPI)) {
                    this.serviceName = ServiceNames.COROSAPI;
                } else if (keys?.includes(ServiceNames.SuuntoApp)) {
                    this.serviceName = ServiceNames.SuuntoApp;
                } else if (keys?.includes(ServiceNames.GarminAPI)) {
                    this.serviceName = ServiceNames.GarminAPI;
                } else {
                    this.serviceName = null;
                }

                this.serviceLogo = this.serviceName
                    ? this.getServiceLogo(this.serviceName)
                    : null;
                this.cd.markForCheck();
            });
    }

    ngOnDestroy(): void {
        this.metadataKeysSubscription?.unsubscribe();
    }

    private getServiceLogo(serviceName: ServiceNames): string {
        switch (serviceName) {
            case ServiceNames.COROSAPI:
                return 'coros';
            case ServiceNames.SuuntoApp:
                return 'suunto';
            case ServiceNames.GarminAPI:
                return 'garmin';
            default:
                return '';
        }
    }
}
