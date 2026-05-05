import { Component, Input } from '@angular/core';

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
    @Input() locked = false;
    @Input() proRequired = false;
    @Input() showDetails = false;

    get statusLabel(): string {
        return this.connected ? 'Connected' : 'Not connected';
    }

    get statusIcon(): string {
        return this.connected ? 'check_circle' : 'link_off';
    }
}
