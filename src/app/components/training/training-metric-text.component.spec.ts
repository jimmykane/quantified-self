import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TrainingMetricTextComponent } from './training-metric-text.component';

describe('TrainingMetricTextComponent', () => {
  it('renders numeric units separately without changing the accessible text order', async () => {
    await TestBed.configureTestingModule({ declarations: [TrainingMetricTextComponent] }).compileComponents();
    const fixture = TestBed.createComponent(TrainingMetricTextComponent);
    fixture.componentRef.setInput('text', '15% higher than usual');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toBe('15% higher than usual');
    expect(fixture.nativeElement.querySelector('.training-metric-token')?.textContent).toBe('15%');
  });
});
