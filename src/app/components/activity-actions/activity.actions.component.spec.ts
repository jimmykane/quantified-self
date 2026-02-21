
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityActionsComponent } from './activity.actions.component';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { ChangeDetectorRef } from '@angular/core';
import { AppEventReprocessService, ReprocessError } from '../../services/app.event-reprocess.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('ActivityActionsComponent', () => {
    let component: ActivityActionsComponent;
    let fixture: ComponentFixture<ActivityActionsComponent>;
    let eventReprocessServiceMock: any;
    let processingServiceMock: any;
    let dialogMock: any;
    let eventMock: any;
    let activityMock: any;
    let userMock: any;

    beforeEach(async () => {
        // Mock user
        userMock = { uid: 'test-user-id' };

        // Mock activity
        activityMock = {
            getID: () => 'activity-1',
            clearStreams: vi.fn(),
            addStreams: vi.fn(),
            clearStats: vi.fn(),
            getAllStreams: () => [],
            hasStreamData: () => true,
        };

        // Mock event
        eventMock = {
            getID: () => 'event-1',
            getActivities: () => [activityMock],
        };
        eventReprocessServiceMock = {
            regenerateActivityStatistics: vi.fn().mockResolvedValue({
                updatedActivityId: 'activity-1',
            }),
        };
        processingServiceMock = {
            addJob: vi.fn().mockReturnValue('job-id'),
            updateJob: vi.fn(),
            completeJob: vi.fn(),
            failJob: vi.fn(),
        };
        dialogMock = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(true),
            }),
        };

        await TestBed.configureTestingModule({
            declarations: [ActivityActionsComponent],
            imports: [
                MatDialogModule,
                MatSnackBarModule,
                MatMenuModule,
                MatIconModule,
                MatDividerModule,
                MatButtonModule
            ],
            providers: [
                { provide: AppEventReprocessService, useValue: eventReprocessServiceMock },
                { provide: AppProcessingService, useValue: processingServiceMock },
                { provide: MatDialog, useValue: dialogMock },
                ChangeDetectorRef
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(ActivityActionsComponent);
        component = fixture.componentInstance;
        component.event = eventMock;
        component.user = userMock;
        component.activity = activityMock;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('reGenerateStatistics', () => {
        it('should delegate to AppEventReprocessService and complete processing job', async () => {
            await component.reGenerateStatistics();
            expect(eventReprocessServiceMock.regenerateActivityStatistics).toHaveBeenCalledWith(
                userMock,
                eventMock,
                'activity-1',
                expect.objectContaining({ onProgress: expect.any(Function) }),
            );
            expect(processingServiceMock.completeJob).toHaveBeenCalled();
        });

        it('should do nothing when confirmation is cancelled', async () => {
            dialogMock.open.mockReturnValueOnce({
                afterClosed: () => of(false),
            });

            await component.reGenerateStatistics();

            expect(eventReprocessServiceMock.regenerateActivityStatistics).not.toHaveBeenCalled();
            expect(processingServiceMock.addJob).not.toHaveBeenCalled();
        });

        it('should fail processing job on reprocess failure', async () => {
            eventReprocessServiceMock.regenerateActivityStatistics.mockRejectedValueOnce(
                new ReprocessError('PARSE_FAILED', 'parse failed'),
            );

            await component.reGenerateStatistics();

            expect(processingServiceMock.failJob).toHaveBeenCalled();
        });
    });
});
