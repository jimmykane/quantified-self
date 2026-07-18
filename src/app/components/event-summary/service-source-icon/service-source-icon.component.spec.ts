import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServiceSourceIconComponent } from './service-source-icon.component';
import { AppEventService } from '../../../services/app.event.service';
import { of } from 'rxjs';
import { EventInterface, ServiceNames, User } from '@sports-alliance/sports-lib';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { buildSourceProviderPresentation } from '../../../helpers/provider-presentation.helper';

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

    it('should render an explicit service source without an event lookup', () => {
        component.sourceServiceName = ServiceNames.SuuntoApp;

        component.ngOnChanges({
            sourceServiceName: {
                currentValue: ServiceNames.SuuntoApp,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true
            }
        });

        expect(eventService.getEventMetaDataKeys).not.toHaveBeenCalled();
        expect(component.serviceName).toBe(ServiceNames.SuuntoApp);
        expect(component.serviceLogo).toBe('suunto');
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

    it('should not query metadata when no lookup user is provided', () => {
        const event = { getID: () => 'event-1' } as any as EventInterface;

        component.user = null;
        component.event = event;
        component.ngOnChanges({
            user: { currentValue: null, previousValue: null, firstChange: true, isFirstChange: () => true },
            event: { currentValue: event, previousValue: null, firstChange: true, isFirstChange: () => true }
        });

        expect(eventService.getEventMetaDataKeys).not.toHaveBeenCalled();
        expect(component.serviceName).toBeNull();
        expect(component.serviceLogo).toBeNull();
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

    it('should detect Wahoo service source', () => {
        const user = { getID: () => 'user-1' } as any as User;
        const event = { getID: () => 'event-1' } as any as EventInterface;
        eventService.getEventMetaDataKeys.mockReturnValue(of([ServiceNames.WahooAPI]));

        component.user = user;
        component.event = event;
        component.ngOnChanges({
            event: { currentValue: event, previousValue: null, firstChange: true, isFirstChange: () => true }
        });

        expect(component.serviceName).toBe(ServiceNames.WahooAPI);
        expect(component.serviceLogo).toBe('wahoo');
        expect(component.serviceDisplayName).toBe('Wahoo');
    });

    it('should clear stale service source when the next lookup has no keys', () => {
        const user = { getID: () => 'user-1' } as any as User;
        const event = { getID: () => 'event-1' } as any as EventInterface;

        eventService.getEventMetaDataKeys.mockReturnValueOnce(of([ServiceNames.GarminAPI]));
        component.user = user;
        component.event = event;
        component.ngOnChanges({
            event: { currentValue: event, previousValue: null, firstChange: true, isFirstChange: () => true }
        });

        expect(component.serviceName).toBe(ServiceNames.GarminAPI);
        expect(component.serviceLogo).toBe('garmin');

        eventService.getEventMetaDataKeys.mockReturnValueOnce(of([]));
        component.ngOnChanges({
            event: { currentValue: event, previousValue: event, firstChange: false, isFirstChange: () => false }
        });

        expect(component.serviceName).toBeNull();
        expect(component.serviceLogo).toBeNull();
    });

    it('should map service names to user-friendly sync labels', () => {
        component.presentation = buildSourceProviderPresentation(ServiceNames.GarminAPI);
        component.ngOnChanges({
            presentation: {
                currentValue: component.presentation,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
        });
        expect(component.serviceDisplayName).toBe('Garmin');

        component.presentation = buildSourceProviderPresentation(ServiceNames.SuuntoApp);
        component.ngOnChanges({
            presentation: {
                currentValue: component.presentation,
                previousValue: null,
                firstChange: false,
                isFirstChange: () => false,
            },
        });
        expect(component.serviceDisplayName).toBe('Suunto');

        component.presentation = buildSourceProviderPresentation(ServiceNames.COROSAPI);
        component.ngOnChanges({
            presentation: {
                currentValue: component.presentation,
                previousValue: null,
                firstChange: false,
                isFirstChange: () => false,
            },
        });
        expect(component.serviceDisplayName).toBe('COROS');
    });

    it('should expose a human-readable tooltip only when enabled', () => {
        component.presentation = buildSourceProviderPresentation(ServiceNames.GarminAPI);
        component.ngOnChanges({
            presentation: {
                currentValue: component.presentation,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
        });

        expect(component.serviceTooltip).toBe('Synced from Garmin');

        component.showTooltip = false;
        component.ngOnChanges({
            showTooltip: {
                currentValue: false,
                previousValue: true,
                firstChange: false,
                isFirstChange: () => false,
            },
        });

        expect(component.serviceTooltip).toBe('');
    });

    it('should include a Garmin device model when a single imported device is clear', () => {
        const event = {
            getActivities: () => [{ creator: { name: 'Edge 540' } }],
        } as unknown as EventInterface;

        component.event = event;
        component.sourceServiceName = ServiceNames.GarminAPI;
        component.ngOnChanges({
            sourceServiceName: {
                currentValue: ServiceNames.GarminAPI,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
            event: {
                currentValue: event,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
        });

        expect(component.serviceDisplayName).toBe('Garmin Edge 540');
        expect(component.serviceTooltip).toBe('Synced from Garmin Edge 540');
    });

    it('should hide source text when it duplicates a visible device label', () => {
        component.presentation = {
            ...buildSourceProviderPresentation(ServiceNames.GarminAPI),
            displayLabel: 'Garmin Edge MTB',
        };
        component.showText = true;
        component.showIcon = false;
        component.suppressedTextLabels = ['  garmin   edge mtb  '];

        component.ngOnChanges({
            presentation: {
                currentValue: component.presentation,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
        });
        fixture.detectChanges();

        expect(component.shouldShowText).toBe(false);
        expect(fixture.nativeElement.querySelector('.service-source-text')).toBeNull();
    });

    it('should keep source text when it differs from the visible device label', () => {
        component.presentation = buildSourceProviderPresentation(ServiceNames.SuuntoApp);
        component.showText = true;
        component.showIcon = false;
        component.suppressedTextLabels = ['Garmin Edge MTB'];

        component.ngOnChanges({
            presentation: {
                currentValue: component.presentation,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
        });
        fixture.detectChanges();

        expect(component.shouldShowText).toBe(true);
        expect(fixture.nativeElement.querySelector('.service-source-text')?.textContent?.trim()).toBe('Suunto');
    });
});
