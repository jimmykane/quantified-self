import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardStatsGridComponent } from './event.card.stats-grid.component';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { signal } from '@angular/core';
import { ActivityInterface, ActivityTypes, EventInterface, UserSummariesSettingsInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { SimpleChange } from '@angular/core';
import { DataAscent, DataDescent, DataDuration } from '@sports-alliance/sports-lib';

describe('EventCardStatsGridComponent', () => {
    let component: EventCardStatsGridComponent;
    let fixture: ComponentFixture<EventCardStatsGridComponent>;
    let mockUserSettingsQueryService: any;

    const mockUnitSettings: UserUnitSettingsInterface = {
        distanceUnits: 'kilometers',
        speedUnits: 'km/h',
        paceUnits: 'min/km',
        weightUnits: 'kg',
        heightUnits: 'cm',
    } as any;

    const mockSummariesSettings: UserSummariesSettingsInterface = {
        removeAscentForEventTypes: [],
        removeDescentForEventTypes: [],
    } as any;

    beforeEach(async () => {
        mockUserSettingsQueryService = {
            unitSettings: signal(mockUnitSettings),
            summariesSettings: signal(mockSummariesSettings),
        };

        await TestBed.configureTestingModule({
            declarations: [EventCardStatsGridComponent],
            providers: [
                { provide: AppUserSettingsQueryService, useValue: mockUserSettingsQueryService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EventCardStatsGridComponent);
        component = fixture.componentInstance;

        // Mock Event
        const mockEvent = {
            getActivities: () => [],
            getActivityTypesAsArray: () => [],
            getStat: (type: string) => null,
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = [];
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should filter out ascent when manually excluded', () => {
        const activityTypes = [ActivityTypes.Cycling];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.Cycling }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => {
                if (type === DataAscent.type) return { getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 };
                if (type === DataDuration.type) return { getDisplayValue: () => '1:00:00', getDisplayUnit: () => '', getValue: () => 3600 };
                return null;
            },
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        // Manually exclude Cycling from ascent
        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [ActivityTypes.Cycling],
            removeDescentForEventTypes: [],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).not.toContain(DataAscent.type);
    });

    it('should filter out descent when manually excluded', () => {
        const activityTypes = [ActivityTypes.Cycling];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.Cycling }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => {
                if (type === DataDescent.type) return { getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 };
                if (type === DataDuration.type) return { getDisplayValue: () => '1:00:00', getDisplayUnit: () => '', getValue: () => 3600 };
                return null;
            },
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        // Manually exclude Cycling from descent
        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [],
            removeDescentForEventTypes: [ActivityTypes.Cycling],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).not.toContain(DataDescent.type);
    });

    it('should include ascent and descent when not excluded', () => {
        const activityTypes = [ActivityTypes.Cycling];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.Cycling }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => ({ getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 }),
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [],
            removeDescentForEventTypes: [],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).toContain(DataAscent.type);
        expect(component.displayedStatsToShow).toContain(DataDescent.type);
    });

    it('should auto-exclude ascent for Alpine Skiing', () => {
        const activityTypes = [ActivityTypes.AlpineSki];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.AlpineSki }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => ({ getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 }),
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [],
            removeDescentForEventTypes: [],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).not.toContain(DataAscent.type);
        expect(component.displayedStatsToShow).toContain(DataDescent.type); // Descent should still be there for alpine skiing
    });
});

