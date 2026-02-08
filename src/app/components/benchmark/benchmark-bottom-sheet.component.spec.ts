import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { BenchmarkBottomSheetComponent } from './benchmark-bottom-sheet.component';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';
import { Component, Input } from '@angular/core';
import { EventInterface, UserSummariesSettingsInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { BottomSheetHeaderComponent } from '../shared/bottom-sheet-header/bottom-sheet-header.component';

// Mock the BenchmarkReportComponent since we're testing the sheet, not the report
@Component({
    selector: 'app-benchmark-report',
    template: '<div>Mock Report</div>',
    standalone: false,
})
class MockBenchmarkReportComponent {
    @Input() result!: BenchmarkResult;
    @Input() event?: EventInterface;
    @Input() unitSettings?: UserUnitSettingsInterface;
    @Input() summariesSettings?: UserSummariesSettingsInterface;
    @Input() referenceColor?: string;
    @Input() testColor?: string;
}

describe('BenchmarkBottomSheetComponent', () => {
    let component: BenchmarkBottomSheetComponent;
    let fixture: ComponentFixture<BenchmarkBottomSheetComponent>;
    let mockBottomSheetRef: { dismiss: ReturnType<typeof vi.fn> };

    const mockResult: BenchmarkResult = {
        referenceId: 'ref-id',
        testId: 'test-id',
        referenceName: 'Garmin Forerunner 265',
        testName: 'COROS PACE 3',
        timestamp: new Date(),
        metrics: {
            gnss: {
                cep50: 2.5,
                cep95: 5.0,
                rmse: 3.0,
                maxDeviation: 10.0,
                totalDistanceDifference: 50,
            },
            streamMetrics: {},
        },
    };

    beforeEach(async () => {
        mockBottomSheetRef = { dismiss: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [
                BenchmarkBottomSheetComponent,
                MockBenchmarkReportComponent,
                BottomSheetHeaderComponent,
            ],
            imports: [
                MatIconModule,
                MatButtonModule,
                MatProgressSpinnerModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: MatBottomSheetRef, useValue: mockBottomSheetRef },
                { provide: MAT_BOTTOM_SHEET_DATA, useValue: { result: mockResult, event: { getActivities: () => [] } } },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(BenchmarkBottomSheetComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have benchmark result data', () => {
        expect(component.data.result).toEqual(mockResult);
    });

    it('should close bottom sheet when close() is called', () => {
        component.close();
        expect(mockBottomSheetRef.dismiss).toHaveBeenCalled();
    });

    it('should pass result to child report component', () => {
        expect(component.data.result.referenceId).toBe('ref-id');
        expect(component.data.result.referenceName).toBe('Garmin Forerunner 265');
        expect(component.data.result.testName).toBe('COROS PACE 3');
    });
});
