import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiInsightsLoadingStateComponent } from './ai-insights-loading-state.component';

describe('AiInsightsLoadingStateComponent', () => {
  let fixture: ComponentFixture<AiInsightsLoadingStateComponent>;
  let component: AiInsightsLoadingStateComponent;

  beforeEach(async () => {
    vi.useFakeTimers();

    await TestBed.configureTestingModule({
      imports: [
        AiInsightsLoadingStateComponent,
        NoopAnimationsModule,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AiInsightsLoadingStateComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Generating insight');
    fixture.componentRef.setInput('copy', 'Parsing your prompt, querying your event stats, and preparing the chart.');
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  it('should render the contained AI loading layout with the default first step', () => {
    const title = fixture.debugElement.query(By.css('.ai-loading-state__title'))?.nativeElement as HTMLElement | undefined;
    const statusLabel = fixture.debugElement.query(By.css('.ai-loading-state__status-label'))?.nativeElement as HTMLElement | undefined;
    const activeRollerRow = fixture.debugElement.query(By.css('.ai-loading-state__roller-row--active'))?.nativeElement as HTMLElement | undefined;
    const previewCards = fixture.debugElement.queryAll(By.css('.ai-loading-state__preview-card'));

    expect(title?.textContent).toContain('Generating insight');
    expect(statusLabel?.textContent).toContain('Step 1/5');
    expect(activeRollerRow?.textContent).toContain('Parsing your prompt');
    expect(previewCards).toHaveLength(2);
  });

  it('should roll the step label forward over time and stop at the final step', () => {
    const statusLabel = (): HTMLElement | undefined =>
      fixture.debugElement.query(By.css('.ai-loading-state__status-label'))?.nativeElement as HTMLElement | undefined;
    const activeRollerRow = (): HTMLElement | undefined =>
      fixture.debugElement.query(By.css('.ai-loading-state__roller-row--active'))?.nativeElement as HTMLElement | undefined;

    vi.advanceTimersByTime(1600);
    fixture.detectChanges();
    expect(statusLabel()?.textContent).toContain('Step 2/5');
    expect(activeRollerRow()?.textContent).toContain('Crunching event stats');

    vi.advanceTimersByTime(6000);
    fixture.detectChanges();
    expect(statusLabel()?.textContent).toContain('Step 5/5');
    expect(activeRollerRow()?.textContent).toContain('Drafting the summary');
  });

  it('should hide the preview cards in compact mode', () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.ai-loading-state__preview-card'))).toHaveLength(0);
  });
});
