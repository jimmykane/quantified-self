import { Component, Input, OnChanges, Output, EventEmitter } from '@angular/core';
import { DataJumpEvent, DynamicDataLoader } from '@sports-alliance/sports-lib';
import { AppUserSettingsQueryService } from '../../../../../services/app.user-settings-query.service';

@Component({
    selector: 'app-jump-marker-popup',
    templateUrl: './jump-marker-popup.component.html',
    styleUrls: ['./jump-marker-popup.component.css'],
    standalone: false
})
export class JumpMarkerPopupComponent implements OnChanges {
    @Input() jump!: DataJumpEvent;
    @Output() dismiss = new EventEmitter<void>();

    constructor(private userSettingsQuery: AppUserSettingsQueryService) {}

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

    getFormattedHangTime(): string {
        if (!this.jump?.jumpData?.hang_time) return '-';
        return this.jump.jumpData.hang_time.getDisplayValue(false, true, true);
    }

    getFormattedSpeed(): string {
        const speed = this.jump?.jumpData?.speed;
        if (!speed) return '-';

        try {
            const convertedStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(
                speed,
                this.userSettingsQuery.unitSettings()
            );
            const preferredSpeed = convertedStats?.[0];
            if (preferredSpeed) {
                return `${preferredSpeed.getDisplayValue()} ${preferredSpeed.getDisplayUnit()}`.trim();
            }
        } catch {
            // Fallback to original speed stat if conversion fails.
        }

        return `${speed.getDisplayValue()} ${speed.getDisplayUnit()}`.trim();
    }
}
