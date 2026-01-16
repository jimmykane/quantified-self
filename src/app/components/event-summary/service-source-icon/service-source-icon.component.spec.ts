import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServiceSourceIconComponent } from './service-source-icon.component';
import { AppEventService } from '../../../services/app.event.service';
import { of } from 'rxjs';
import { EventInterface, ServiceNames, User } from '@sports-alliance/sports-lib';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

describe('ServiceSourceIconComponent', () => {
    let component: ServiceSourceIconComponent;
    let fixture: ComponentFixture<ServiceSourceIconComponent>;
    let eventService: any;

    beforeEach(async () => {
        eventService = {
            getEventMetaDataKeys: vi.fn().mockReturnValue(of([]))
        };

        await TestBed.configureTestingModule({
            declarations: [ServiceSourceIconComponent],
            imports: [MatIconModule, MatTooltipModule],
            providers: [
                { provide: AppEventService, useValue: eventService }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(ServiceSourceIconComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should detect Garmin service source', () => {
        const user = { getID: () => 'user-1' } as any as User;
        const event = { getID: () => 'event-1' } as any as EventInterface;
        eventService.getEventMetaDataKeys.mockReturnValue(of([ServiceNames.GarminAPI]));

        component.user = user;
        component.event = event;
        component.ngOnChanges({
            user: { currentValue: user, previousValue: null, firstChange: true, isFirstChange: () => true },
            event: { currentValue: event, previousValue: null, firstChange: true, isFirstChange: () => true }
        });

        expect(component.serviceName).toBe(ServiceNames.GarminAPI);
        expect(component.serviceLogo).toBe('garmin');
    });

    it('should detect Suunto service source', () => {
        const user = { getID: () => 'user-1' } as any as User;
        const event = { getID: () => 'event-1' } as any as EventInterface;
        eventService.getEventMetaDataKeys.mockReturnValue(of([ServiceNames.SuuntoApp]));

        component.user = user;
        component.event = event;
        component.ngOnChanges({
            event: { currentValue: event, previousValue: null, firstChange: true, isFirstChange: () => true }
        });

        expect(component.serviceName).toBe(ServiceNames.SuuntoApp);
        expect(component.serviceLogo).toBe('suunto');
    });

    it('should detect Coros service source', () => {
        const user = { getID: () => 'user-1' } as any as User;
        const event = { getID: () => 'event-1' } as any as EventInterface;
        eventService.getEventMetaDataKeys.mockReturnValue(of([ServiceNames.COROSAPI]));

        component.user = user;
        component.event = event;
        component.ngOnChanges({
            event: { currentValue: event, previousValue: null, firstChange: true, isFirstChange: () => true }
        });

        expect(component.serviceName).toBe(ServiceNames.COROSAPI);
        expect(component.serviceLogo).toBe('coros');
    });
});
