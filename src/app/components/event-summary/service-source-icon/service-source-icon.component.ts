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
    @Input() sourceServiceName: ServiceNames | null = null;
    @Input() showIcon = true;
    @Input() showTooltip = true;
    @Input() showText = false;

    serviceName: ServiceNames | null = null;
    serviceLogo: string | null = null;
    private metadataKeysSubscription?: Subscription;

    constructor(private eventService: AppEventService, private cd: ChangeDetectorRef) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (this.sourceServiceName) {
            this.metadataKeysSubscription?.unsubscribe();
            this.setServiceSource(this.sourceServiceName);
            return;
        }

        if (changes['sourceServiceName']) {
            this.checkServiceSource();
            return;
        }

        if (changes['event'] || changes['user']) {
            this.checkServiceSource();
        }
    }

    private checkServiceSource() {
        this.metadataKeysSubscription?.unsubscribe();

        const eventID = this.event?.getID?.();
        if (!this.user || !this.event || !eventID) {
            this.setServiceSource(null);
            return;
        }
        this.metadataKeysSubscription = this.eventService.getEventMetaDataKeys(this.user, eventID)
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

                this.setServiceSource(this.serviceName);
            });
    }

    ngOnDestroy(): void {
        this.metadataKeysSubscription?.unsubscribe();
    }

    get serviceDisplayName(): string {
        switch (this.serviceName) {
            case ServiceNames.COROSAPI:
                return 'COROS';
            case ServiceNames.SuuntoApp:
                return 'Suunto';
            case ServiceNames.GarminAPI:
                return 'Garmin';
            default:
                return '';
        }
    }

    get serviceTooltip(): string {
        if (!this.showTooltip || !this.serviceName) {
            return '';
        }

        return `Synced from ${this.serviceDisplayName || this.serviceName}`;
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

    private setServiceSource(serviceName: ServiceNames | null): void {
        this.serviceName = serviceName;
        this.serviceLogo = serviceName
            ? this.getServiceLogo(serviceName)
            : null;
        this.cd.markForCheck();
    }
}
