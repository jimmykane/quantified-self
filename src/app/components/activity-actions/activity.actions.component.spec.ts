
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityActionsComponent } from './activity.actions.component';
import { AppEventService } from '../../services/app.event.service';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { ChangeDetectorRef } from '@angular/core';
import { ActivityInterface, EventInterface, EventUtilities } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { vi } from 'vitest';

describe('ActivityActionsComponent', () => {
    let component: ActivityActionsComponent;
    let fixture: ComponentFixture<ActivityActionsComponent>;
    let eventServiceMock: any;
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
            removeActivity: vi.fn(),
        };

        // Mock AppEventService
        eventServiceMock = {
            attachStreamsToEventWithActivities: vi.fn(),
            writeAllEventData: vi.fn().mockResolvedValue(true),
            deleteAllActivityData: vi.fn().mockResolvedValue(true),
        };

        await TestBed.configureTestingModule({
            declarations: [ActivityActionsComponent],
            imports: [
                MatDialogModule,
                MatSnackBarModule,
                RouterTestingModule,
                MatMenuModule,
                MatIconModule,
                MatDividerModule,
                MatButtonModule
            ],
            providers: [
                { provide: AppEventService, useValue: eventServiceMock },
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
        it('should call attachStreamsToEventWithActivities, reGenerateStatsForEvent, and writeAllEventData', async () => {
            // Arrange
            const freshActivityMock = {
                getID: () => 'activity-1',
                getAllStreams: () => [],
            };
            const freshEventMock = {
                getActivities: () => [freshActivityMock],
                getID: () => 'event-1'
            };

            eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(of(freshEventMock));
            const reGenerateStatsSpy = vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

            // Act
            await component.reGenerateStatistics();

            // Assert
            expect(eventServiceMock.attachStreamsToEventWithActivities).toHaveBeenCalledWith(userMock, eventMock);
            expect(reGenerateStatsSpy).toHaveBeenCalledWith(eventMock);
            expect(eventServiceMock.writeAllEventData).toHaveBeenCalledWith(userMock, eventMock);
        });
    });
});
