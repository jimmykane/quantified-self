import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { TrainingSnapshotPreviewComponent } from './training-snapshot-preview.component';

describe('TrainingSnapshotPreviewComponent', () => {
  let fixture: ComponentFixture<TrainingSnapshotPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrainingSnapshotPreviewComponent, MatIconTestingModule],
      providers: [{ provide: EChartsLoaderService, useValue: { init: vi.fn().mockResolvedValue(null), dispose: vi.fn() } }],
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
    expect(fixture.nativeElement.querySelectorAll('app-metric-history-chart')).toHaveLength(7);
    expect(fixture.componentInstance.loadMetrics.find(metric => metric.id === 'monotony')?.history).toBeUndefined();
    expect(fixture.componentInstance.loadMetrics.find(metric => metric.id === 'form-plus-seven')?.history?.mode).toBe('forecast');
    const form = fixture.componentInstance.loadMetrics.find(metric => metric.id === 'form-now')!.history!;
    const forecast = fixture.componentInstance.loadMetrics.find(metric => metric.id === 'form-plus-seven')!.history!;
    expect(forecast.points[0]).toEqual(form.points.at(-1));
    expect(forecast.points.at(-1)!.time - forecast.points[0].time).toBe(7 * 86400000);
    expect(forecast.points.at(-1)!.value).toBeCloseTo(62 * (41 / 42) ** 7 - 54 * (6 / 7) ** 7);
  });
});
