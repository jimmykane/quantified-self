import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BenchmarkSelectionDialogComponent, BenchmarkSelectionData } from './benchmark-selection-dialog.component';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatListModule } from '@angular/material/list';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivityInterface } from '@sports-alliance/sports-lib';

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
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: mockData },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(BenchmarkSelectionDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should not allow confirmation with fewer than 2 selections', () => {
        component.selection.clear();
        component.selection.select(mockData.activities[0]);

        component.confirm();

        expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should close dialog with selected activities when confirmed', () => {
        component.selection.clear();
        component.selection.select(mockData.activities[0], mockData.activities[1]);

        component.confirm();

        expect(mockDialogRef.close).toHaveBeenCalledWith([
            mockData.activities[0],
            mockData.activities[1]
        ]);
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
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: dataWithInitial },
            ],
        }).compileComponents();

        const newFixture = TestBed.createComponent(BenchmarkSelectionDialogComponent);
        const newComponent = newFixture.componentInstance;

        expect(newComponent.selection.selected.length).toBe(2);
    });

    it('should have correct number of activities from data', () => {
        expect(component.data.activities.length).toBe(3);
    });
});
