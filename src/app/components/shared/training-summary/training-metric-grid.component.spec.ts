import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { TrainingMetricGridComponent } from './training-metric-grid.component';

describe('TrainingMetricGridComponent', () => {
  let fixture: ComponentFixture<TrainingMetricGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TrainingMetricGridComponent] }).compileComponents();
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
});
