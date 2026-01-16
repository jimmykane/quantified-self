import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { EventInterface, ServiceNames, User } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../../services/app.event.service';

@Component({
    selector: 'app-service-source-icon',
    templateUrl: './service-source-icon.component.html',
    styleUrls: ['./service-source-icon.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ServiceSourceIconComponent implements OnChanges {
    @Input() event!: EventInterface;
    @Input() user!: User;

    serviceName: ServiceNames | null = null;
    serviceLogo: string | null = null;

    constructor(private eventService: AppEventService, private cd: ChangeDetectorRef) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['event'] || changes['user']) {
            this.checkServiceSource();
        }
    }

    private checkServiceSource() {
        if (!this.user || !this.event || !this.event.getID()) {
            this.serviceName = null;
            this.serviceLogo = null;
            this.cd.markForCheck();
            return;
        }
        this.eventService.getEventMetaDataKeys(this.user, this.event.getID()!).subscribe(keys => {
            if (keys && keys.length > 0) {
                if (keys.includes(ServiceNames.COROSAPI)) {
                    this.serviceName = ServiceNames.COROSAPI;
                } else if (keys.includes(ServiceNames.SuuntoApp)) {
                    this.serviceName = ServiceNames.SuuntoApp;
                } else if (keys.includes(ServiceNames.GarminAPI)) {
                    this.serviceName = ServiceNames.GarminAPI;
                } else {
                    this.serviceName = null;
                }

                if (this.serviceName) {
                    this.serviceLogo = this.getServiceLogo(this.serviceName);
                } else {
                    this.serviceLogo = null;
                }
                this.cd.markForCheck();
            }
        });
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
