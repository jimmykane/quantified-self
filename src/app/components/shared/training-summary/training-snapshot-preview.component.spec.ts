import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { TrainingSnapshotPreviewComponent } from './training-snapshot-preview.component';

describe('TrainingSnapshotPreviewComponent', () => {
  let fixture: ComponentFixture<TrainingSnapshotPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrainingSnapshotPreviewComponent, MatIconTestingModule],
    }).compileComponents();
    fixture = TestBed.createComponent(TrainingSnapshotPreviewComponent);
    fixture.detectChanges();
  });

  it('reuses the Training summary components with deterministic example data', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('app-training-summary-cards')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('app-training-metric-grid')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.training-snapshot-preview').hasAttribute('data-nosnippet')).toBe(true);
    expect(text).toContain('Readiness today');
    expect(text).toContain('Fitness (CTL)');
    expect(text).toContain('Recovery debt');
  });
});
