import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventSummaryComponent } from './event-summary.component';
import { AppEventService } from '../../services/app.event.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ChangeDetectorRef, Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { EventInterface, User, Privacy, ActivityTypes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';



describe('EventSummaryComponent', () => {
    let component: EventSummaryComponent;
    let fixture: ComponentFixture<EventSummaryComponent>;
    let mockEventService: any;
    let mockBottomSheet: any;

    const mockUser: User = {
        uid: 'test-user-id',
    } as any;

    const mockEvent = {
        getID: () => 'test-event-id',
        privacy: Privacy.Private,
        getActivities: () => [{ type: ActivityTypes.Running }],
        getStat: (type: string) => null,
        startDate: new Date(),
    } as unknown as EventInterface;

    beforeEach(async () => {
        mockEventService = {
            setEventPrivacy: vi.fn().mockResolvedValue(true),
        };

        mockBottomSheet = {
            open: vi.fn(),
        };

        await TestBed.configureTestingModule({
            declarations: [
                EventSummaryComponent
            ],
            providers: [
                { provide: AppEventService, useValue: mockEventService },
                { provide: MatBottomSheet, useValue: mockBottomSheet },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(EventSummaryComponent);
        component = fixture.componentInstance;
        component.event = mockEvent;
        component.user = mockUser;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('toggleEventPrivacy', () => {
        it('should toggle privacy locally and call service', async () => {
            component.event.privacy = Privacy.Private;
            await component.toggleEventPrivacy();

            expect(component.event.privacy).toBe(Privacy.Public);
            expect(mockEventService.setEventPrivacy).toHaveBeenCalledWith(
                mockUser,
                'test-event-id',
                Privacy.Public
            );
        });

        it('should not do anything if no user or event id', async () => {
            component.user = null as any;
            const initialPrivacy = component.event.privacy;
            await component.toggleEventPrivacy();
            expect(component.event.privacy).toBe(initialPrivacy);
            expect(mockEventService.setEventPrivacy).not.toHaveBeenCalled();
        });
    });

    describe('open... methods', () => {
        it('openEditDetails should open bottom sheet', () => {
            component.openEditDetails();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });

        it('openDetailedStats should open bottom sheet', () => {
            component.openDetailedStats();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });

        // openDevices requires data mocking for checks, but basic call check:
        it('openDevices should open bottom sheet', () => {
            component.openDevices();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });
    });

    describe('Getters', () => {
        it('mainActivityType should return activity type', () => {
            expect(component.mainActivityType).toBe(ActivityTypes.Running);
        });

        it('getHeroStats should return specific stats for Running', () => {
            const stats = component.getHeroStats();
            // Running usually returns [DataDistance.type, DataDuration.type]
            expect(stats.length).toBe(2);
        });
    });
});

