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
    let measuredWidth = 720;
    let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn>;
    let bottomSheetContainer: HTMLElement;

    const createDomRect = (height: number, width = 0): DOMRect => ({
        x: 0,
        y: 0,
        width,
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
        measuredWidth = 720;
        getBoundingClientRectSpy = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockImplementation(function (this: HTMLElement): DOMRect {
                if (this.classList?.contains('mat-bottom-sheet-container')) {
                    return createDomRect(measuredHeight, measuredWidth);
                }
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
        bottomSheetContainer = document.createElement('div');
        bottomSheetContainer.classList.add('mat-bottom-sheet-container');
        bottomSheetContainer.append(fixture.nativeElement);
        document.body.append(bottomSheetContainer);
    });

    afterEach(() => {
        getBoundingClientRectSpy?.mockRestore();
        bottomSheetContainer?.remove();
    });

    it('should create and dismiss when close is called', () => {
        expect(component).toBeTruthy();

        component.close();

        expect(bottomSheetRefMock.dismiss).toHaveBeenCalledTimes(1);
    });

    it('should capture and lock the initial bottom sheet width after first render', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.lockedSheetHeightPx).toBe(500);

        const container: HTMLElement = fixture.nativeElement.querySelector('.bottom-sheet-container');
        expect(container.style.height).toBe('500px');
        expect(component.lockedSheetWidthPx).toBe(720);
        expect(bottomSheetContainer.style.width).toBe('720px');
        expect(bottomSheetContainer.style.minWidth).toBe('720px');
    });

    it('should keep the locked width when content shrinks after filtering', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.lockedSheetHeightPx).toBe(500);
        expect(component.lockedSheetWidthPx).toBe(720);

        measuredHeight = 200;
        measuredWidth = 320;
        (component as any).captureAndLockSheetHeight();
        (component as any).captureAndLockSheetWidth();
        fixture.detectChanges();

        expect(component.lockedSheetHeightPx).toBe(500);
        expect(component.lockedSheetWidthPx).toBe(720);

        const container: HTMLElement = fixture.nativeElement.querySelector('.bottom-sheet-container');
        expect(container.style.height).toBe('500px');
        expect(bottomSheetContainer.style.width).toBe('720px');
        expect(bottomSheetContainer.style.minWidth).toBe('720px');
    });
});
