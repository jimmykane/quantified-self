import { Component, Input, OnChanges, Output, EventEmitter } from '@angular/core';
import { DataInterface, DataJumpEvent, DynamicDataLoader } from '@sports-alliance/sports-lib';
import { AppUserSettingsQueryService } from '../../../../../services/app.user-settings-query.service';

@Component({
    selector: 'app-jump-marker-popup',
    templateUrl: './jump-marker-popup.component.html',
    styleUrls: ['./jump-marker-popup.component.scss'],
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

    private getUnitAwareStat(stat: DataInterface | null | undefined): DataInterface | null {
        if (!stat) {
            return null;
        }

        try {
            const convertedStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(
                stat,
                this.userSettingsQuery.unitSettings()
            );
            return convertedStats?.[0] ?? stat;
        } catch {
            return stat;
        }
    }

    private formatStatDisplay(stat: DataInterface | null | undefined): string {
        const preferredStat = this.getUnitAwareStat(stat);
        if (!preferredStat) {
            return '-';
        }

        const value = preferredStat.getDisplayValue();
        const unit = preferredStat.getDisplayUnit();
        return `${value} ${unit}`.trim();
    }

    getFormattedDistance(): string {
        return this.formatStatDisplay(this.jump?.jumpData?.distance ?? null);
    }

    getFormattedHeight(): string {
        return this.formatStatDisplay(this.jump?.jumpData?.height ?? null);
    }

    getFormattedScore(): string {
        return this.formatStatDisplay(this.jump?.jumpData?.score ?? null);
    }

    getFormattedHangTime(): string {
        if (!this.jump?.jumpData?.hang_time) return '-';
        return this.jump.jumpData.hang_time.getDisplayValue(false, true, true);
    }

    getFormattedSpeed(): string {
        return this.formatStatDisplay(this.jump?.jumpData?.speed ?? null);
    }

    getFormattedRotations(): string {
        return this.formatStatDisplay(this.jump?.jumpData?.rotations ?? null);
    }
}
