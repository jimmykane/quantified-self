import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { BenchmarkBottomSheetComponent } from './benchmark-bottom-sheet.component';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BenchmarkResult } from '@shared/app-event.interface';
import { Component, Input } from '@angular/core';
import { EventInterface, UserSummariesSettingsInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { BottomSheetHeaderComponent } from '../shared/bottom-sheet-header/bottom-sheet-header.component';
import { AppShareService } from '../../services/app.share.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';

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
    let shareServiceMock: { shareBenchmarkAsImage: ReturnType<typeof vi.fn> };
    let originalMatchMedia: typeof window.matchMedia | undefined;

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
        shareServiceMock = {
            shareBenchmarkAsImage: vi.fn().mockResolvedValue('data:image/png;base64,QUJD'),
        };
        originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockReturnValue({
                matches: false,
                media: '(max-width: 600px)',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }),
        });

        await TestBed.configureTestingModule({
            declarations: [
                BenchmarkBottomSheetComponent,
                MockBenchmarkReportComponent,
                BottomSheetHeaderComponent,
            ],
            imports: [
                MatIconModule,
                MatButtonModule,
                MatMenuModule,
                MatProgressSpinnerModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: MatBottomSheetRef, useValue: mockBottomSheetRef },
                { provide: MAT_BOTTOM_SHEET_DATA, useValue: { result: mockResult, event: { getActivities: () => [] } } },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: AppShareService, useValue: shareServiceMock },
                { provide: AppEventColorService, useValue: { getActivityColor: vi.fn().mockReturnValue('#000000') } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(BenchmarkBottomSheetComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        if (originalMatchMedia) {
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                value: originalMatchMedia,
            });
        }
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

    it('should use custom brandText plus Quantified Self in export watermark', async () => {
        component.data.brandText = '  My Brand  ';
        component.shareFrame = {
            nativeElement: document.createElement('div'),
        } as any;

        await (component as any).buildSharePayload();

        expect(shareServiceMock.shareBenchmarkAsImage).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({
                watermark: expect.objectContaining({
                    brand: 'My Brand',
                    logoUrl: expect.stringContaining('assets/logos/app/logo-100x100.png'),
                }),
            }),
        );
    });

    it('should fallback to Quantified Self when brandText is empty', async () => {
        component.data.brandText = '   ';
        component.shareFrame = {
            nativeElement: document.createElement('div'),
        } as any;

        await (component as any).buildSharePayload();

        expect(shareServiceMock.shareBenchmarkAsImage).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({
                watermark: expect.objectContaining({
                    brand: '',
                    logoUrl: expect.stringContaining('assets/logos/app/logo-100x100.png'),
                }),
            }),
        );
    });
});
