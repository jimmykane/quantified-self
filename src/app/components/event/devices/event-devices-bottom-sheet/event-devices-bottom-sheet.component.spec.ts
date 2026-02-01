import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';
import { EventDevicesBottomSheetComponent } from './event-devices-bottom-sheet.component';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

describe('EventDevicesBottomSheetComponent', () => {
    let component: EventDevicesBottomSheetComponent;
    let fixture: ComponentFixture<EventDevicesBottomSheetComponent>;
    let mockBottomSheetRef: any;

    beforeEach(async () => {
        mockBottomSheetRef = {
            dismiss: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [EventDevicesBottomSheetComponent],
            imports: [MatBottomSheetModule, MatIconModule],
            providers: [
                { provide: MatBottomSheetRef, useValue: mockBottomSheetRef },
                {
                    provide: MAT_BOTTOM_SHEET_DATA,
                    useValue: {
                        event: { getID: () => '1' },
                        selectedActivities: []
                    }
                }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(EventDevicesBottomSheetComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should close when close is called', () => {
        component.close();
        expect(mockBottomSheetRef.dismiss).toHaveBeenCalled();
    });
});
