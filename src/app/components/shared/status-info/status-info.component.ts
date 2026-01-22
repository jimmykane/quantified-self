import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-status-info',
    templateUrl: './status-info.component.html',
    styleUrls: ['./status-info.component.css'],
    standalone: false
})
export class StatusInfoComponent {
    @Input() type: 'success' | 'pending' | 'warning' | 'error' | 'info' = 'info';
    @Input() title: string = '';
    @Input() description: string = '';
}
