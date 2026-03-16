import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-loading-overlay',
    templateUrl: './loading-overlay.component.html',
    styleUrls: ['./loading-overlay.component.css'],
    standalone: false
})
export class AppLoadingOverlayComponent {
    @Input() isLoading: boolean = false;
    @Input() hasError: boolean = false;
    @Input() allowErrorPassthrough: boolean = false;
    @Input() errorMessage: string = '';
    @Input() mode: 'determinate' | 'indeterminate' | 'buffer' | 'query' = 'indeterminate';
    @Input() height: string = '100%';
    @Input() minHeight: string = '';
    @Input() width: string = '100%';
    @Input() borderRadius: string = '4px';
    @Input() showProgressBar: boolean = true;
    @Input() showSkeleton: boolean = false;
    @Input() showShade: boolean = true; // Option to include the shade/dimming effect
    @Input() errorHint: string = '';
    @Input() errorIcon: string = 'insights';
}
