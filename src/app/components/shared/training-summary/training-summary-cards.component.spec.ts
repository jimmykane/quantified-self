import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { TrainingSummaryCardsComponent } from './training-summary-cards.component';

describe('TrainingSummaryCardsComponent', () => {
  let fixture: ComponentFixture<TrainingSummaryCardsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TrainingSummaryCardsComponent] }).compileComponents();
    fixture = TestBed.createComponent(TrainingSummaryCardsComponent);
  });

  it('renders shared state, metric text, and indicators in workspace mode', () => {
    fixture.componentRef.setInput('cards', [
      {
        id: 'state',
        label: 'State',
        valueText: 'Balanced',
        captionText: 'TSS-only load model',
        kind: 'state',
      },
      {
        id: 'training-time',
        label: 'Training time',
        valueText: '18h 42m',
        captionText: '+12% versus usual',
        indicator: {
          label: 'Training time versus usual',
          value: 12,
          variant: 'deviation',
        },
      },
    ]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.training-state-panel')).toBeTruthy();
    expect(element.querySelectorAll('.qs-glass-card-panel')).toHaveLength(2);
    expect(element.querySelectorAll('app-metric-indicator')).toHaveLength(1);
    expect(element.querySelector('.training-metric-token')?.textContent).toContain('18h');
    expect(element.textContent).toContain('TSS-only load model');
  });

  it('uses the compact preview presentation and preserves status semantics', () => {
    fixture.componentRef.setInput('mode', 'preview');
    fixture.componentRef.setInput('cards', [{
      id: 'preparing',
      label: 'Training comparison',
      valueText: 'Preparing',
      captionText: 'Reading recent workouts.',
      span: 'double',
      announcesStatus: true,
    }]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.training-summary-grid--preview')).toBeTruthy();
    expect(element.querySelector('.qs-glass-card-panel')).toBeNull();
    expect(element.querySelector('article')?.getAttribute('role')).toBe('status');
  });
});
