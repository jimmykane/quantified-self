import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ReviewerBenchmarkPreviewComponent } from './reviewer-benchmark-preview.component';

describe('ReviewerBenchmarkPreviewComponent', () => {
  let fixture: ComponentFixture<ReviewerBenchmarkPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewerBenchmarkPreviewComponent, MatIconTestingModule],
    }).compileComponents();
    fixture = TestBed.createComponent(ReviewerBenchmarkPreviewComponent);
    fixture.detectChanges();
  });

  it('shares the three compact benchmark rows and their evidence previews', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelectorAll('app-compact-feature-row')).toHaveLength(3);
    expect(text).toContain('Benchmark Merge Workflow');
    expect(text).toContain('GNSS Trace Comparison');
    expect(text).toContain('Sensor Quality Reports');
    expect(text).toContain('Save / Share');
  });
});
