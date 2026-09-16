import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
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
    ['health-sleep', 'health'],
    ['health-hrv', 'health'],
    ['health-weight', 'health'],
    ['training-snapshot', 'training'],
    ['training-signals', 'signals'],
    ['training-readiness', 'readiness'],
    ['training-explorer', 'explorer'],
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
