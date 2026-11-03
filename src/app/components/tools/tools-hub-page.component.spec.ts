import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';

import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { ToolsHubPageComponent } from './tools-hub-page.component';

describe('ToolsHubPageComponent', () => {
  it('renders the tools hub with the compare tool link', () => {
    const analyticsServiceMock = {
      logToolCompareEntry: vi.fn(),
    };
    const haptics = { selection: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ToolsHubPageComponent, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
      providers: [
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
        { provide: AppHapticsService, useValue: haptics },
      ],
    });

    const fixture: ComponentFixture<ToolsHubPageComponent> = TestBed.createComponent(ToolsHubPageComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const compareLink = fixture.nativeElement.querySelector('a[routerlink="/tools/compare"], a[ng-reflect-router-link="/tools/compare"]');

    expect(text).toContain('Workout data tools');
    expect(text).toContain('File comparison');
    expect(text).not.toMatch(/\bprivate\b/i);
    expect(compareLink).toBeTruthy();

    const cards = [...fixture.nativeElement.querySelectorAll('mat-card')] as HTMLElement[];
    const analysis = cards.find(card => card.textContent!.includes('File analysis'))!;
    const benchmarks = cards.find(card => card.textContent!.includes('Device benchmarks'))!;
    expect(analysis.querySelector('a')?.getAttribute('href')).toBe('/dashboard');
    expect(analysis.textContent).toContain('Available in your account');
    expect(analysis.textContent).toContain('Open Dashboard');
    expect(analysis.textContent).toContain('Upload an activity');
    expect(benchmarks.querySelector('a')?.getAttribute('href')).toBe('/tools/compare/saved');
    expect(benchmarks.textContent).toContain('Available in your account');
    expect(benchmarks.textContent).toContain('Open Saved Comparisons');
    expect(text).toContain('Sign in');
    expect(text).toContain('activity allowance');
    expect(text).not.toContain('Roadmap');
    expect(text).not.toContain('Learn More');
    expect(haptics.selection).not.toHaveBeenCalled();

    fixture.componentInstance.logCompareEntry('tools_hub_hero');
    expect(analyticsServiceMock.logToolCompareEntry).toHaveBeenCalledWith('tools_hub_hero');

    fixture.componentInstance.logToolCardEntry('/tools/compare');
    expect(analyticsServiceMock.logToolCompareEntry).toHaveBeenCalledWith('tools_hub_card');
    fixture.componentInstance.logToolCardEntry('/dashboard');
    fixture.componentInstance.logToolCardEntry('/tools/compare/saved');
    // ShellNavigationEffectsService owns navigation feedback; cards must not duplicate it.
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logToolCompareEntry).toHaveBeenCalledTimes(2);
  });
});
