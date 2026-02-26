import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    fixture.detectChanges();
    vi.clearAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should keep menu panel classes in template', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/event/chart/actions/event.card.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('should emit xAxisType changes and log analytics', async () => {
    const xAxisTypeEmitSpy = vi.spyOn(component.xAxisTypeChange, 'emit');

    await component.onXAxisTypeChange(XAxisTypes.Distance);

    expect(xAxisTypeEmitSpy).toHaveBeenCalledWith(XAxisTypes.Distance);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'xAxisType' });
  });

  it('should emit showAllData changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.showAllDataChange, 'emit');

    await component.onShowAllDataToggle(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'showAllData' });
  });

  it('should emit showLaps changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.showLapsChange, 'emit');

    await component.onShowLapsToggle(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'showLaps' });
  });
});
