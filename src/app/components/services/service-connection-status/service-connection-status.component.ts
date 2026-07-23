import { Component, Input } from '@angular/core';
import { ProviderIconKey } from '@shared/provider-presentation';

@Component({
    selector: 'app-service-connection-status',
    templateUrl: './service-connection-status.component.html',
    styleUrls: ['./service-connection-status.component.scss'],
    standalone: false
})
export class ServiceConnectionStatusComponent {
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
