
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

    it('should throw on init when required inputs are missing', () => {
        const missingInputsFixture = TestBed.createComponent(ActivityActionsComponent);
        const missingInputsComponent = missingInputsFixture.componentInstance;
        missingInputsComponent.user = null as any;
        missingInputsComponent.event = null as any;

        expect(() => missingInputsComponent.ngOnInit()).toThrow('Component needs events and user');
    });

    it('should open edit dialog with expected payload', () => {
        component.editActivity();

        expect(dialogMock.open).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                width: '75vw',
                data: expect.objectContaining({
                    event: eventMock,
                    activity: activityMock,
                    user: userMock,
                }),
            }),
        );
    });

    it('should expose hydration and distance helpers', () => {
        activityMock.getAllStreams = () => [{ type: 'distance' }];
        activityMock.hasStreamData = vi.fn().mockReturnValue(true);

        expect(component.isHydrated()).toBe(true);
        expect(component.hasDistance()).toBe(true);
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

        it('should update processing job titles from backend progress phases', async () => {
            eventReprocessServiceMock.regenerateActivityStatistics.mockImplementationOnce(
                async (_user: any, _event: any, _activityId: string, options: any) => {
                    options.onProgress?.({ phase: 'parsing', progress: 45, details: 'step: parse file' });
                    options.onProgress?.({ phase: 'done', progress: 100 });
                    return { updatedActivityId: 'activity-1' };
                },
            );

            await component.reGenerateStatistics();

            expect(processingServiceMock.updateJob).toHaveBeenCalledWith('job-id', expect.objectContaining({
                title: 'Parsing source files...',
                status: 'processing',
                progress: 45,
            }));
            expect(processingServiceMock.updateJob).toHaveBeenCalledWith('job-id', expect.objectContaining({
                title: 'Done',
                status: 'completed',
                progress: 100,
            }));
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

        it('should map NO_ORIGINAL_FILES to a friendly error message', async () => {
            eventReprocessServiceMock.regenerateActivityStatistics.mockRejectedValueOnce(
                new ReprocessError('NO_ORIGINAL_FILES', 'no files'),
            );

            await component.reGenerateStatistics();

            expect(processingServiceMock.failJob).toHaveBeenCalledWith('job-id', 'Re-calculation failed');
        });
    });
});
