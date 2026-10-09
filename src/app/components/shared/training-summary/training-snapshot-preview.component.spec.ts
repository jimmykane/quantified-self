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

  it('keeps example Form and Ramp history consistent with the same dated CTL and ATL observations', () => {
    const metrics = fixture.componentInstance.loadMetrics;
    const fitness = metrics.find(metric => metric.id === 'fitness')!.history!;
    const fatigue = metrics.find(metric => metric.id === 'fatigue')!.history!;
    const form = metrics.find(metric => metric.id === 'form-now')!.history!;
    const ramp = metrics.find(metric => metric.id === 'ramp')!.history!;
    const ctlByTime = new Map(fitness.points.map(point => [point.time, point.value]));
    const atlByTime = new Map(fatigue.points.map(point => [point.time, point.value]));
    for (const point of form.points) {
      expect(point.value).toBeCloseTo(ctlByTime.get(point.time)! - atlByTime.get(point.time)!);
    }
    for (const point of ramp.points) {
      const priorCtl = ctlByTime.get(point.time - 7 * 86400000);
      expect(priorCtl).toBeDefined();
      expect(point.value).toBeCloseTo(ctlByTime.get(point.time)! - priorCtl!);
    }
    for (const id of ['fitness', 'fatigue', 'form-now', 'ramp']) {
      const metric = metrics.find(metric => metric.id === id)!;
      expect(metric.valueText).toBe(metric.history!.points.at(-1)!.valueText);
    }
  });
});
