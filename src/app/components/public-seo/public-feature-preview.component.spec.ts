import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonToggle } from '@angular/material/button-toggle';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { DashboardHealthService } from '../../services/dashboard-health.service';
import { HealthOverviewPreviewComponent } from './health-overview-preview.component';
import { TrainingExplorerPreviewComponent } from './training-explorer-preview.component';
import { PublicFeaturePreviewComponent } from './public-feature-preview.component';
import type { PublicFeaturePreviewKey } from './public-feature-preview.types';

describe('PublicFeaturePreviewComponent', () => {
  let fixture: ComponentFixture<PublicFeaturePreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      imports: [PublicFeaturePreviewComponent, MatIconTestingModule, NoopAnimationsModule],
    }).compileComponents();
  });

  function renderPlaceholder(previewKey: PublicFeaturePreviewKey): HTMLElement {
    fixture = TestBed.createComponent(PublicFeaturePreviewComponent);
    fixture.componentRef.setInput('previewKey', previewKey);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it.each([
    ['health-overview', 'health-overview'],
    ['health-sleep', 'health'],
    ['health-hrv', 'health'],
    ['health-weight', 'health'],
    ['training-snapshot', 'training'],
    ['training-signals', 'signals'],
    ['training-readiness', 'readiness'],
    ['training-explorer', 'explorer'],
    ['training-plans', 'training-plans'],
    ['dashboard', 'dashboard'],
    ['workout-analysis', 'workout'],
    ['activity-map', 'map'],
    ['reviewer-benchmark', 'reviewer'],
    ['assistant-example', 'assistant'],
    ['mcp-flow', 'mcp'],
    ['provider-flow', 'flow'],
  ] as const)('keeps %s behind a fixed SSR-safe placeholder', (previewKey, placeholderClass) => {
    const element = renderPlaceholder(previewKey);
    const placeholder = element.querySelector(`.preview-placeholder--${placeholderClass}`);

    expect(placeholder).toBeTruthy();
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
    expect(placeholder?.closest('div[data-nosnippet]')).toBeTruthy();
    expect(element.querySelector('app-health-preview')).toBeNull();
    expect(element.querySelector('app-training-explorer-preview')).toBeNull();
  });

  it('keeps hydrated previews inside the same native snippet exclusion', async () => {
    const element = renderPlaceholder('mcp-flow');
    const wrapper = element.querySelector('div[data-nosnippet]');
    const blocks = await fixture.getDeferBlocks();
    await blocks[0].render(DeferBlockState.Complete);
    expect(element.querySelector('app-mcp-read-only-flow-preview')?.closest('div[data-nosnippet]')).toBe(wrapper);
  });
  it('hydrates the current Health overview as a static example inside the snippet exclusion', async () => {
    const watch = vi.fn(), selection = vi.fn();
    TestBed.overrideProvider(DashboardHealthService, { useValue: { isOwner: () => true, watch } });
    TestBed.overrideProvider(AppThemeService, { useValue: { appTheme: signal(AppThemes.Normal) } });
    TestBed.overrideProvider(AppHapticsService, { useValue: { selection } });
    TestBed.overrideProvider(EChartsLoaderService, { useValue: {
      init: vi.fn().mockResolvedValue({ isDisposed: () => false, dispatchAction: vi.fn(), on: vi.fn(), off: vi.fn(), getWidth: () => 320 }),
      setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
      subscribeToViewportResize: () => () => undefined, attachMobileSeriesTapFeedback: () => () => undefined,
    } });
    TestBed.overrideProvider(LoggerService, { useValue: { error: vi.fn() } });
    const element = renderPlaceholder('health-overview'), wrapper = element.querySelector('div[data-nosnippet]');
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete); fixture.detectChanges(); await fixture.whenStable();
    const preview = fixture.debugElement.query(By.directive(HealthOverviewPreviewComponent));
    expect(preview.nativeElement.closest('div[data-nosnippet]')).toBe(wrapper);
    expect(preview.nativeElement.querySelectorAll('.health-overview-card')).toHaveLength(6);
    expect(element.textContent).toContain('Fictional sample readings');
    expect(watch).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
  });

  it('hydrates the Training Plans fixture without account-data services', async () => {
    const selection = vi.fn();
    TestBed.overrideProvider(AppHapticsService, { useValue: { selection } });
    TestBed.overrideProvider(EChartsLoaderService, { useValue: {
      init: vi.fn().mockResolvedValue({ on: vi.fn(), off: vi.fn(), dispatchAction: vi.fn(), isDisposed: () => false }),
      setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => vi.fn()), attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
    } });
    const element = renderPlaceholder('training-plans');
    const wrapper = element.querySelector('div[data-nosnippet]');
    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Complete);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('app-training-plans-preview')?.closest('div[data-nosnippet]')).toBe(wrapper);
    expect(element.textContent).toContain('Run + ride build');
    expect(element.textContent).toContain('Threshold bike blocks');
    expect(selection).not.toHaveBeenCalled();
    const toggle = fixture.debugElement.queryAll(By.directive(MatButtonToggle))
      .find(button => button.componentInstance.value === 'profile')!;
    toggle.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(element.querySelector('app-workout-profile')?.closest('div[data-nosnippet]')).toBe(wrapper);
    expect(element.textContent).toContain('This sample is read-only; nothing is saved');
    expect(element.textContent).toContain('Workout prescription');
    expect(selection).toHaveBeenCalledOnce();
  });

  it.each(['training-readiness', 'training-explorer'] as const)(
    'hydrates %s into the correct shared view without account-data providers', async previewKey => {
      const selection = vi.fn();
      TestBed.overrideProvider(AppThemeService, { useValue: { appTheme: signal(AppThemes.Normal) } });
      TestBed.overrideProvider(AppHapticsService, { useValue: { selection } });
      TestBed.overrideProvider(EChartsLoaderService, { useValue: {
        init: vi.fn().mockResolvedValue({ dispatchAction: vi.fn(), isDisposed: () => false }),
        setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
        subscribeToViewportResize: vi.fn(() => vi.fn()), attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
      } });
      TestBed.overrideProvider(LoggerService, { useValue: { error: vi.fn() } });
      const element = renderPlaceholder(previewKey);
      const wrapper = element.querySelector('div[data-nosnippet]');
      expect(element.querySelector('app-training-explorer-preview')).toBeNull();
      const blocks = await fixture.getDeferBlocks();
      expect(blocks).toHaveLength(1);
      await blocks[0].render(DeferBlockState.Complete);
      await fixture.whenStable();
      fixture.detectChanges();
      const preview = fixture.debugElement.query(By.directive(TrainingExplorerPreviewComponent));
      expect(preview.componentInstance.kind()).toBe(previewKey === 'training-readiness' ? 'readiness' : 'explorer');
      expect(preview.nativeElement.closest('div[data-nosnippet]')).toBe(wrapper);
      expect(element.querySelector('app-training-readiness-trend-chart') !== null).toBe(previewKey === 'training-readiness');
      expect(element.querySelector('app-training-mix-details') !== null).toBe(previewKey === 'training-explorer');
      expect(selection).not.toHaveBeenCalled();
    },
  );
});
