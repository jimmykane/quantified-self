import { Component, Input, OnChanges, Output, EventEmitter } from '@angular/core';
import { DataJumpEvent } from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-jump-marker-popup',
    templateUrl: './jump-marker-popup.component.html',
    styleUrls: ['./jump-marker-popup.component.css'],
    standalone: false
})
export class JumpMarkerPopupComponent implements OnChanges {
    @Input() jump!: DataJumpEvent;
    @Output() dismiss = new EventEmitter<void>();

    onClose() {
        this.dismiss.emit();
    }

    ngOnChanges() {
        // Component receives new jump data
    }

    getFormattedScore(): string {
        if (!this.jump?.jumpData?.score) return '-';
        // Use any cast to avoid strict type issues with potential library mismatches
        const val = (this.jump.jumpData.score as any).getDisplayValue();
        const num = parseFloat(val);
        if (!isNaN(num)) {
            return num.toFixed(1);
        }
        return val;
    }
}
