import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventInterface, User, XAxisTypes } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { EventCardChartActionsComponent } from './event.card.chart.actions.component';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';

describe('EventCardChartActionsComponent', () => {
    let component: EventCardChartActionsComponent;
    let fixture: ComponentFixture<EventCardChartActionsComponent>;

    const analyticsServiceMock = {
        logEvent: vi.fn(),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [EventCardChartActionsComponent],
            imports: [
                CommonModule,
                BrowserAnimationsModule,
                MatButtonModule,
                MatFormFieldModule,
                MatIconModule,
                MatMenuModule,
                MatSelectModule,
                MatSlideToggleModule,
                MatTooltipModule,
            ],
            providers: [
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EventCardChartActionsComponent);
        component = fixture.componentInstance;
        component.user = { uid: 'test-user' } as User;
        component.event = { isMultiSport: () => false } as EventInterface;
        component.xAxisType = XAxisTypes.Duration;
        component.showAllData = false;
        component.showLaps = false;
        component.stackYAxes = false;
        fixture.detectChanges();
        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should emit stackYAxes changes and log analytics', async () => {
        const stackYAxesEmitSpy = vi.spyOn(component.stackYAxesChange, 'emit');

        await component.onStackYAxesToggle(true);

        expect(component.stackYAxes).toBe(true);
        expect(stackYAxesEmitSpy).toHaveBeenCalledWith(true);
        expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'stackYAxes' });
    });

    it('should emit xAxisType changes and log analytics', async () => {
        const xAxisTypeEmitSpy = vi.spyOn(component.xAxisTypeChange, 'emit');

        await component.onXAxisTypeChange(XAxisTypes.Distance);

        expect(component.xAxisType).toBe(XAxisTypes.Distance);
        expect(xAxisTypeEmitSpy).toHaveBeenCalledWith(XAxisTypes.Distance);
        expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'xAxisType' });
    });

    it('should emit all changes on fallback and log analytics', async () => {
        const showAllDataEmitSpy = vi.spyOn(component.showAllDataChange, 'emit');
        const showLapsEmitSpy = vi.spyOn(component.showLapsChange, 'emit');
        const stackYAxesEmitSpy = vi.spyOn(component.stackYAxesChange, 'emit');
        const xAxisTypeEmitSpy = vi.spyOn(component.xAxisTypeChange, 'emit');

        component.showAllData = true;
        component.showLaps = true;
        component.stackYAxes = true;
        component.xAxisType = XAxisTypes.Time;

        await component.somethingChanged();

        expect(showAllDataEmitSpy).toHaveBeenCalledWith(true);
        expect(showLapsEmitSpy).toHaveBeenCalledWith(true);
        expect(stackYAxesEmitSpy).toHaveBeenCalledWith(true);
        expect(xAxisTypeEmitSpy).toHaveBeenCalledWith(XAxisTypes.Time);
        expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: undefined });
    });
});
