import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { EventStatsBottomSheetComponent } from './event-stats-bottom-sheet.component';

describe('EventStatsBottomSheetComponent', () => {
    let fixture: ComponentFixture<EventStatsBottomSheetComponent>;
    let component: EventStatsBottomSheetComponent;
    let bottomSheetRefMock: { dismiss: ReturnType<typeof vi.fn> };
    let measuredHeight = 500;
    let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn>;

    const createDomRect = (height: number): DOMRect => ({
        x: 0,
        y: 0,
        width: 0,
        height,
        top: 0,
        right: 0,
        bottom: height,
        left: 0,
        toJSON: () => ({})
    } as DOMRect);

    beforeEach(async () => {
        bottomSheetRefMock = {
            dismiss: vi.fn(),
        };

        measuredHeight = 500;
        getBoundingClientRectSpy = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockImplementation(function (this: HTMLElement): DOMRect {
                if (this.classList?.contains('bottom-sheet-container')) {
                    return createDomRect(measuredHeight);
                }
                return createDomRect(0);
            });

        await TestBed.configureTestingModule({
            declarations: [EventStatsBottomSheetComponent],
            providers: [
                {
                    provide: MAT_BOTTOM_SHEET_DATA,
                    useValue: {
                        event: {},
                        selectedActivities: [],
                        userUnitSettings: {}
                    }
                },
                {
                    provide: MatBottomSheetRef,
                    useValue: bottomSheetRefMock
                }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(EventStatsBottomSheetComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        getBoundingClientRectSpy?.mockRestore();
    });

    it('should create and dismiss when close is called', () => {
        expect(component).toBeTruthy();

        component.close();

        expect(bottomSheetRefMock.dismiss).toHaveBeenCalledTimes(1);
    });

    it('should capture and lock the initial bottom sheet height after first render', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.lockedSheetHeightPx).toBe(500);

        const container: HTMLElement = fixture.nativeElement.querySelector('.bottom-sheet-container');
        expect(container.style.height).toBe('500px');
    });

    it('should keep the locked height when content shrinks after filtering', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.lockedSheetHeightPx).toBe(500);

        measuredHeight = 200;
        (component as any).captureAndLockSheetHeight();
        fixture.detectChanges();

        expect(component.lockedSheetHeightPx).toBe(500);

        const container: HTMLElement = fixture.nativeElement.querySelector('.bottom-sheet-container');
        expect(container.style.height).toBe('500px');
    });
});
