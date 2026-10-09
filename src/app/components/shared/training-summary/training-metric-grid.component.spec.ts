import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TrainingMetricGridComponent } from './training-metric-grid.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';

describe('TrainingMetricGridComponent', () => {
  async function createFixture(): Promise<ComponentFixture<TrainingMetricGridComponent>> {
    await TestBed.configureTestingModule({
      imports: [TrainingMetricGridComponent],
      providers: [{ provide: EChartsLoaderService, useValue: { init: vi.fn().mockResolvedValue(null), dispose: vi.fn() } }],
    }).compileComponents();
    return TestBed.createComponent(TrainingMetricGridComponent);
  }

  it('adapts columns and dividers to narrow desktop panels as well as phone widths', () => {
    // JSDOM does not lay out container queries; browser QA verifies the actual geometry.
    const styles = readFileSync(resolve(process.cwd(), 'src/app/components/shared/training-summary/training-metric-grid.component.scss'), 'utf8');
    expect(styles).toContain('container-type: inline-size');
    expect(styles).toContain('@container (max-width: 640px)');
    expect(styles).not.toContain('@media (max-width: 640px)');
    const narrowStyles = styles.slice(styles.indexOf('@container (max-width: 640px)'));
    expect(narrowStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(narrowStyles).toContain('.training-metric-grid--workspace > div:nth-child(odd)');
    expect(narrowStyles).toContain('.training-metric-grid--workspace > div:nth-child(even)');
    expect(narrowStyles).toContain('.training-metric-grid--preview-load > div:nth-child(n + 3)');
    expect(narrowStyles).toContain('.training-metric-grid--preview-context > div:not(:first-child)');
  });

  it('keeps workspace rows compact without stretching the panel or changing preview padding', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/components/shared/training-summary/training-metric-grid.component.scss'), 'utf8');
    expect(styles).toMatch(/:host\s*\{[^}]*align-self:\s*start;/s);
    expect(styles).toMatch(/\.training-metric-grid\s*\{[^}]*align-content:\s*start;/s);
    expect(styles).toMatch(/\.training-metric-grid--workspace > div\s*\{\s*padding:\s*12px 16px;\s*\}/s);
    expect(styles).toMatch(/\.training-metric-grid--workspace app-metric-history-chart\s*\{\s*padding-top:\s*4px;\s*\}/s);
    expect(styles).toMatch(/\.training-metric-grid app-metric-history-chart\s*\{[^}]*margin-top:\s*auto;/s);
    expect(styles).toMatch(/\.training-metric-grid--preview-context > div\s*\{\s*padding:\s*\.9rem 1rem;/s);
  });

  it('renders exact metric values through the shared numeric formatter', async () => {
    const fixture = await createFixture();
    fixture.componentRef.setInput('metrics', [
      { id: 'ctl', label: 'CTL', valueText: '62' },
      { id: 'recovery', label: 'Recovery left', valueText: '8h 20m', detailText: 'Imported estimate' },
    ]);
    fixture.componentRef.setInput('ariaLabel', 'Training load metrics');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('dl')?.getAttribute('aria-label')).toBe('Training load metrics');
    expect(element.querySelectorAll('dt')).toHaveLength(2);
    expect(element.querySelectorAll('.training-metric-token').length).toBeGreaterThan(1);
    expect(element.textContent).toContain('Imported estimate');
  });

  it('selects the preview-context layout without a workspace surface', async () => {
    const fixture = await createFixture();
    fixture.componentRef.setInput('mode', 'preview-context');
    fixture.componentRef.setInput('metrics', [{ id: 'efficiency', label: 'Efficiency', valueText: '+3.2%' }]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.training-metric-grid--preview-context')).toBeTruthy();
    expect(element.querySelector('.qs-glass-card-panel')).toBeNull();
  });

  it('adds history below the existing value only when observed data exists', async () => {
    const fixture = await createFixture();
    fixture.componentRef.setInput('metrics', [
      { id: 'zero', label: 'Form', valueText: '0', history: { caption: '8-week history', points: [{ time: 1, value: 0, valueText: '0' }] } },
      { id: 'missing', label: 'CTL', valueText: '--', history: { caption: '8-week history', points: [{ time: 1, value: null, valueText: '--' }] } },
      { id: 'monotony', label: 'Monotony', valueText: '1.2' },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('dt')).toHaveLength(3);
    expect(fixture.nativeElement.querySelectorAll('app-metric-history-chart')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('dd')?.textContent).toBe('0');
  });
});
