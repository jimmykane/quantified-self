import { Component, Input, computed, inject, input } from '@angular/core';
import { ProviderIconKey, getProviderDisplayName } from '@shared/provider-presentation';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import type { ProMembershipOffer } from '../../../helpers/membership-selection.helper';

@Component({
    selector: 'app-service-connection-status',
    templateUrl: './service-connection-status.component.html',
    styleUrls: ['./service-connection-status.component.scss'],
    standalone: false
})
export class ServiceConnectionStatusComponent {
    readonly proOffer = input<ProMembershipOffer | null>(null);
    readonly offerServices: Record<ProviderIconKey, ServiceNames> = {
        garmin: ServiceNames.GarminAPI, suunto: ServiceNames.SuuntoApp,
        coros: ServiceNames.COROSAPI, wahoo: ServiceNames.WahooAPI,
    };
    readonly offerProviderNames = Object.fromEntries(Object.entries(this.offerServices)
        .map(([key, service]) => [key, getProviderDisplayName(service, 'source')]));
    private readonly users = inject(AppUserService);
    readonly hasTrainingPlanningUIAccess = computed(() => !!this.users.user()?.uid);
    readonly keepPlanLabel = computed(() => {
        const role = this.users.user()?.stripeRole;
        return role && role !== 'free' ? 'Keep current plan' : 'Keep using Starter';
    });
    @Input() serviceLabel = '';
    @Input() description = '';
    @Input() connected = false;
    @Input() automaticImports = false;
    @Input() loading = false;
    @Input() compact = false;
    @Input() locked = false;
    @Input() proRequired = false;
    @Input() showDetails = false;
    @Input() statusLabelOverride: string | null = null;
    @Input() statusIconOverride: string | null = null;
    @Input() statusTone: 'default' | 'attention' = 'default';
    @Input() providerIcon: ProviderIconKey | null = null;

    get statusLabel(): string {
        if (this.statusLabelOverride) {
            return this.statusLabelOverride;
        }
        return this.connected ? 'Connected' : 'Not connected';
    }

    get statusIcon(): string {
        if (this.statusIconOverride) {
            return this.statusIconOverride;
        }
        return this.connected ? 'check_circle' : 'link_off';
    }
}
