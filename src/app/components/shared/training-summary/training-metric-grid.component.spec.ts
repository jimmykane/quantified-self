import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TrainingMetricGridComponent } from './training-metric-grid.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';

describe('TrainingMetricGridComponent', () => {
  let fixture: ComponentFixture<TrainingMetricGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrainingMetricGridComponent],
      providers: [{ provide: EChartsLoaderService, useValue: { init: vi.fn().mockResolvedValue(null), dispose: vi.fn() } }],
    }).compileComponents();
    fixture = TestBed.createComponent(TrainingMetricGridComponent);
  });

  it('renders exact metric values through the shared numeric formatter', () => {
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

  it('selects the preview-context layout without a workspace surface', () => {
    fixture.componentRef.setInput('mode', 'preview-context');
    fixture.componentRef.setInput('metrics', [{ id: 'efficiency', label: 'Efficiency', valueText: '+3.2%' }]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.training-metric-grid--preview-context')).toBeTruthy();
    expect(element.querySelector('.qs-glass-card-panel')).toBeNull();
  });

  it('adds history below the existing value only when observed data exists', () => {
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
