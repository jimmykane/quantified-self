import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-loading-overlay',
    templateUrl: './loading-overlay.component.html',
    styleUrls: ['./loading-overlay.component.css'],
    standalone: false
})
export class AppLoadingOverlayComponent {
    @Input() isLoading: boolean = false;
    @Input() height: string = '100%';
    @Input() minHeight: string = '';
    @Input() width: string = '100%';
    @Input() borderRadius: string = '4px';
    @Input() showShade: boolean = true; // Option to include the shade/dimming effect
}
