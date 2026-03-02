import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    ActivityInterface,
    EventInterface,
    LapInterface,
    LapTypes,
    UserUnitSettingsInterface
} from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { EventCardLapsComponent } from './event.card.laps.component';
import { AppEventColorService } from '../../../services/color/app.event.color.service';

function createActivity(laps: LapInterface[]): ActivityInterface {
    return {
        type: 'Running',
        getID: () => 'activity-1',
        getLaps: () => laps,
    } as ActivityInterface;
}

function createRenderableLap(type: LapTypes): LapInterface {
    return {
        type,
        getStatsAsArray: () => [],
        getStat: () => undefined,
        getDuration: () => ({
            getDisplayValue: () => '00:10',
        }),
    } as unknown as LapInterface;
}

describe('EventCardLapsComponent', () => {
    let component: EventCardLapsComponent;
    let fixture: ComponentFixture<EventCardLapsComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [EventCardLapsComponent],
            providers: [
                { provide: AppEventColorService, useValue: {} },
                { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn(), detectChanges: vi.fn() } },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();

        fixture = TestBed.createComponent(EventCardLapsComponent);
        component = fixture.componentInstance;
        component.selectedActivities = [] as ActivityInterface[];
        component.unitSettings = {} as UserUnitSettingsInterface;
        component.event = { getActivities: () => [] } as EventInterface;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should resolve renderable lap types when visible laps exist', () => {
        const activity = createActivity([
            createRenderableLap(LapTypes.Manual),
        ]);
        component.selectedActivities = [activity];
        component.ngOnChanges();

        expect(component.availableLapTypes).toEqual([LapTypes.Manual]);
        expect(component.getDataSource(activity, LapTypes.Manual)).toBeTruthy();
    });

    it('should exclude session end laps from the rendered lap tables', () => {
        const activity = createActivity([
            { type: LapTypes.session_end } as LapInterface,
        ]);
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.availableLapTypes).toEqual([]);
        expect(component.getDataSource(activity, LapTypes.session_end)).toBeUndefined();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('app-event-section-header')).toBeNull();
    });
});
