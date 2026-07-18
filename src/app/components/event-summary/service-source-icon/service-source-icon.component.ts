import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { EventInterface, ServiceNames, User } from '@sports-alliance/sports-lib';
import { ProviderPresentation } from '@shared/provider-presentation';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { buildSourceProviderPresentation } from '../../../helpers/provider-presentation.helper';
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
    @Input() user: User | null = null;
    @Input() sourceServiceName: ServiceNames | null = null;
    @Input() presentation: ProviderPresentation | null = null;
    @Input() showIcon = true;
    @Input() showTooltip = true;
    @Input() showText = false;
    @Input() suppressedTextLabels: readonly string[] = [];

    serviceName: ServiceNames | null = null;
    serviceLogo: string | null = null;
    serviceDisplayName = '';
    serviceTooltipText = '';
    private servicePresentation: ProviderPresentation | null = null;
    private metadataKeysSubscription?: Subscription;

    constructor(private eventService: AppEventService, private cd: ChangeDetectorRef) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (this.presentation) {
            this.metadataKeysSubscription?.unsubscribe();
            this.applyPresentation(this.presentation);
            return;
        }

        if (this.sourceServiceName) {
            this.metadataKeysSubscription?.unsubscribe();
            this.setServiceSource(this.sourceServiceName);
            return;
        }

        if (changes['showTooltip'] && this.serviceName) {
            this.setServiceSource(this.serviceName);
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
                if (keys?.includes(ServiceNames.WahooAPI)) {
                    this.serviceName = ServiceNames.WahooAPI;
                } else if (keys?.includes(ServiceNames.COROSAPI)) {
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

    get serviceTooltip(): string {
        return this.serviceTooltipText;
    }

    get shouldShowText(): boolean {
        if (!this.showText || !this.serviceName) {
            return false;
        }

        const displayName = this.normalizeLabel(this.serviceDisplayName || this.serviceName);
        return !!displayName && !this.suppressedTextLabels
            .map(label => this.normalizeLabel(label))
            .some(label => label === displayName);
    }

    private normalizeLabel(label: unknown): string {
        return typeof label === 'string'
            ? label.trim().replace(/\s+/g, ' ').toLowerCase()
            : '';
    }

    private applyPresentation(presentation: ProviderPresentation | null): void {
        this.servicePresentation = presentation;
        this.serviceName = presentation?.serviceName ?? null;
        this.serviceLogo = presentation?.iconKey ?? null;
        this.serviceDisplayName = presentation?.displayLabel ?? '';
        this.serviceTooltipText = this.showTooltip ? presentation?.tooltipLabel ?? '' : '';
        this.cd.markForCheck();
    }

    private setServiceSource(serviceName: ServiceNames | null): void {
        this.applyPresentation(buildSourceProviderPresentation(serviceName, this.event));
    }
}
