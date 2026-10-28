import { AppHapticsService } from '../../services/app.haptics.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BenchmarkSelectionDialogComponent, BenchmarkSelectionData } from './benchmark-selection-dialog.component';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatListModule } from '@angular/material/list';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { AppDeviceColorPreferenceService } from '../../services/color/app-device-color-preference.service';

const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };

describe('BenchmarkSelectionDialogComponent', () => {
    let component: BenchmarkSelectionDialogComponent;
    let fixture: ComponentFixture<BenchmarkSelectionDialogComponent>;
    let mockDialogRef: { close: ReturnType<typeof vi.fn> };

    const createMockActivity = (id: string, name: string, creatorName?: string): Partial<ActivityInterface> => ({
        getID: () => id,
        name,
        startDate: new Date('2023-01-01T10:00:00Z'),
        endDate: new Date('2023-01-01T11:00:00Z'),
        creator: creatorName ? { name: creatorName } : undefined,
    });

    const mockData: BenchmarkSelectionData = {
        activities: [
            createMockActivity('act1', 'Morning Run', 'Garmin Forerunner 265') as ActivityInterface,
            createMockActivity('act2', 'Morning Run', 'COROS PACE 3') as ActivityInterface,
            createMockActivity('act3', '', 'Suunto 9 Peak') as ActivityInterface,
        ],
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        mockDialogRef = { close: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [BenchmarkSelectionDialogComponent],
            imports: [
                CommonModule,
                MatListModule,
                MatDialogModule,
                MatButtonModule,
                MatIconModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: AppHapticsService, useValue: haptics },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: mockData },
                { provide: AppDeviceColorPreferenceService, useValue: { getPreferredDeviceColor: vi.fn(() => null) } },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();

        fixture = TestBed.createComponent(BenchmarkSelectionDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('only gives feedback for changed list selection and alignment choices', () => {
        const selection = { source: { selectedOptions: { selected: [{ value: mockData.activities[0] }] } } };
        component.onSelectionChange(selection as never);
        component.onSelectionChange(selection as never);
        expect(haptics.selection).toHaveBeenCalledTimes(1);
        component.setAutoAlignTime(true);
        expect(haptics.selection).toHaveBeenCalledTimes(1);
        component.setAutoAlignTime(false);
        expect(haptics.selection).toHaveBeenCalledTimes(2);
        component.isLoading = true;
        component.setAutoAlignTime(true); component.swapActivities(); component.confirm();
        expect(haptics.selection).toHaveBeenCalledTimes(2);
        expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('gives one feedback for swapping a valid pair and cancelling', () => {
        component.swapActivities();
        expect(haptics.selection).not.toHaveBeenCalled();
        component.selectedActivities = [mockData.activities[0], mockData.activities[1]];
        component.swapActivities();
        expect(component.selectedActivities).toEqual([mockData.activities[1], mockData.activities[0]]);
        expect(haptics.selection).toHaveBeenCalledTimes(1);
        component.cancel();
        expect(haptics.selection).toHaveBeenCalledTimes(2);
        expect(mockDialogRef.close).toHaveBeenCalledOnce();
    });

    it('should create' , () => {
        expect(component).toBeTruthy();
        expect(haptics.selection).not.toHaveBeenCalled();
    });

    it('should not allow confirmation with fewer than 2 selections', () => {
        component.selectedActivities = [mockData.activities[0]];

        component.confirm();

        expect(mockDialogRef.close).not.toHaveBeenCalled();
        expect(haptics.selection).not.toHaveBeenCalled();
    });

    it('should close dialog with selected activities when confirmed', () => {
        component.selectedActivities = [mockData.activities[0], mockData.activities[1]];

        component.confirm();

        expect(haptics.selection).toHaveBeenCalledOnce();
        expect(haptics.success).not.toHaveBeenCalled();
        expect(mockDialogRef.close).toHaveBeenCalledWith({
            activities: [mockData.activities[0], mockData.activities[1]],
            options: { autoAlignTime: true }
        });
    });

    it('should initialize with initial selection if provided', async () => {
        const dataWithInitial: BenchmarkSelectionData = {
            activities: mockData.activities,
            initialSelection: [mockData.activities[0], mockData.activities[1]],
        };

        await TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            declarations: [BenchmarkSelectionDialogComponent],
            imports: [
                CommonModule,
                MatListModule,
                MatDialogModule,
                MatButtonModule,
                MatIconModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: AppHapticsService, useValue: haptics },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: dataWithInitial },
                { provide: AppDeviceColorPreferenceService, useValue: { getPreferredDeviceColor: vi.fn(() => null) } },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();

        const newFixture = TestBed.createComponent(BenchmarkSelectionDialogComponent);
        const newComponent = newFixture.componentInstance;

        expect(newComponent.selectedActivities.length).toBe(2);
    });

    it('should have correct number of activities from data', () => {
        expect(component.data.activities.length).toBe(3);
    });
});
