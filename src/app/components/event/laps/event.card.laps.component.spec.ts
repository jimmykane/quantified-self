import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { EventCardLapsComponent } from './event.card.laps.component';
import { AppEventColorService } from '../../../services/color/app.event.color.service';

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
        component.selectedActivities = [] as any;
        component.unitSettings = {} as any;
        component.event = { getActivities: () => [] } as any;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render shared section header', () => {
        const header = fixture.nativeElement.querySelector('app-event-section-header');
        expect(header).toBeTruthy();
        expect(header.getAttribute('icon')).toBe('linear_scale');
        expect(header.getAttribute('title')).toBe('Laps');
    });
});
