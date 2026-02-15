import { AfterViewInit, Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { EventInterface, ActivityInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-event-stats-bottom-sheet',
    templateUrl: './event-stats-bottom-sheet.component.html',
    styleUrls: ['./event-stats-bottom-sheet.component.scss'],
    standalone: false
})
export class EventStatsBottomSheetComponent implements AfterViewInit {
    @ViewChild('sheetContainer', { static: true })
    private sheetContainerRef!: ElementRef<HTMLElement>;

    public lockedSheetHeightPx: number | null = null;

    constructor(
        @Inject(MAT_BOTTOM_SHEET_DATA) public data: {
            event: EventInterface,
            selectedActivities: ActivityInterface[],
            userUnitSettings: UserUnitSettingsInterface
        },
        private bottomSheetRef: MatBottomSheetRef<EventStatsBottomSheetComponent>
    ) { }

    close(): void {
        this.bottomSheetRef.dismiss();
    }

    ngAfterViewInit(): void {
        setTimeout(() => this.captureAndLockSheetHeight());
    }

    private captureAndLockSheetHeight(): void {
        if (this.lockedSheetHeightPx !== null) {
            return;
        }

        const sheetContainer = this.sheetContainerRef?.nativeElement;
        if (!sheetContainer) {
            return;
        }

        let measuredHeight = sheetContainer.getBoundingClientRect().height;
        if (!(measuredHeight > 0)) {
            measuredHeight = sheetContainer.offsetHeight;
        }

        if (!(measuredHeight > 0)) {
            const matBottomSheetContainer = sheetContainer.closest('.mat-bottom-sheet-container') as HTMLElement | null;
            measuredHeight = matBottomSheetContainer?.getBoundingClientRect().height || matBottomSheetContainer?.offsetHeight || 0;
        }

        if (!(measuredHeight > 0)) {
            return;
        }

        this.lockedSheetHeightPx = Math.round(Math.min(measuredHeight, this.getViewportMaxHeight()));
    }

    private getViewportMaxHeight(): number {
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
        if (!(viewportHeight > 0)) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.max(viewportHeight - 32, 0);
    }
}
