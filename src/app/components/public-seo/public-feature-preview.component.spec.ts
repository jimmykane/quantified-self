import { ComponentFixture, DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';
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
    ['training-snapshot', 'training'],
    ['training-signals', 'signals'],
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
  });
});
