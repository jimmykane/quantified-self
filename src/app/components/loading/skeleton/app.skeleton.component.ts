import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-skeleton',
    template: '',
    styleUrls: ['./app.skeleton.component.css'],
    standalone: false,
    host: {
        '[style.width]': 'width',
        '[style.height]': 'height',
        '[style.border-radius]': 'borderRadius'
    }
})
export class AppSkeletonComponent {
    @Input() width: string = '100%';
    @Input() height: string = '20px';
    @Input() borderRadius: string = '4px';

    constructor() { }

    // Bind styles to host element
    public get hostStyles(): { [key: string]: string } {
        return {
            'width': this.width,
            'height': this.height,
            'border-radius': this.borderRadius
        };
    }
}
