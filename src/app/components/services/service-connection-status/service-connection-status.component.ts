import { Component, Input, computed, inject } from '@angular/core';
import { ProviderIconKey } from '@shared/provider-presentation';
import { isTrainingPlanningUIAllowed } from '@shared/training-planning-rollout';
import { AppUserService } from '../../../services/app.user.service';

@Component({
    selector: 'app-service-connection-status',
    templateUrl: './service-connection-status.component.html',
    styleUrls: ['./service-connection-status.component.scss'],
    standalone: false
})
export class ServiceConnectionStatusComponent {
    private readonly users = inject(AppUserService);
    readonly hasTrainingPlanningUIAccess = computed(() => isTrainingPlanningUIAllowed(this.users.user()?.uid));
    @Input() serviceLabel = '';
    @Input() description = '';
    @Input() connected = false;
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
