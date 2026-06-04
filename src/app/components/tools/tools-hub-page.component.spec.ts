import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';

import { AppAnalyticsService } from '../../services/app.analytics.service';
import { ToolsHubPageComponent } from './tools-hub-page.component';

describe('ToolsHubPageComponent', () => {
  it('renders the tools hub with the compare tool link', () => {
    const analyticsServiceMock = {
      logToolCompareEntry: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ToolsHubPageComponent, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
      providers: [
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
      ],
    });

    const fixture: ComponentFixture<ToolsHubPageComponent> = TestBed.createComponent(ToolsHubPageComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const compareLink = fixture.nativeElement.querySelector('a[routerlink="/tools/compare"], a[ng-reflect-router-link="/tools/compare"]');

    expect(text).toContain('Workout data tools');
    expect(text).toContain('File comparison');
    expect(compareLink).toBeTruthy();

    fixture.componentInstance.logCompareEntry('tools_hub_hero');
    expect(analyticsServiceMock.logToolCompareEntry).toHaveBeenCalledWith('tools_hub_hero');

    fixture.componentInstance.logToolCardEntry('/tools/compare');
    expect(analyticsServiceMock.logToolCompareEntry).toHaveBeenCalledWith('tools_hub_card');
  });
});
