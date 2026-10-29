import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, of } from 'rxjs';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { DashboardChartPreviewComponent } from './dashboard-chart-preview.component';
import { DashboardChartPreviewService } from '../../../services/dashboard-chart-preview.service';
import { getDashboardChartCatalog } from '../../../helpers/dashboard-chart-catalog.helper';
import { buildDashboardExamplePreview } from '../../../helpers/dashboard-chart-preview.helper';
import { AppUserUtilities } from '../../../utils/app.user.utilities';

describe('chart preview rendering contract', () => {
  const watch = vi.fn();
  const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'custom-distance-columns')!.tile;
  beforeEach(() => {
    watch.mockReset().mockReturnValue(of(buildDashboardExamplePreview(tile)));
    TestBed.configureTestingModule({ declarations: [DashboardChartPreviewComponent], schemas: [NO_ERRORS_SCHEMA], providers: [{ provide: DashboardChartPreviewService, useValue: { watch } }] });
  });
  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])('passes %s user preferences to the existing canonical chart renderer', distanceUnits => {
    const fixture = TestBed.createComponent(DashboardChartPreviewComponent);
    const user = { uid: 'example', settings: { unitSettings: { ...AppUserUtilities.getDefaultUserUnitSettings(), distanceUnits } } };
    fixture.componentRef.setInput('user', user); fixture.componentRef.setInput('tile', tile); fixture.detectChanges();
    const chart = fixture.debugElement.query(By.css('app-tile-chart'));
    expect(chart.properties['user']).toBe(user); expect(chart.properties['previewMode']).toBe(true); expect(chart.properties['showActions']).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Example data');
  });
  it('keeps examples explicitly labelled while loading and never subscribes for thumbnails', () => {
    watch.mockReturnValue(of({ ...buildDashboardExamplePreview(tile), loading: true }));
    const fixture = TestBed.createComponent(DashboardChartPreviewComponent);
    fixture.componentRef.setInput('user', { uid: 'example', settings: { unitSettings: {} } }); fixture.componentRef.setInput('tile', tile); fixture.componentRef.setInput('thumbnail', true); fixture.detectChanges();
    expect(watch).not.toHaveBeenCalled();
    fixture.componentRef.setInput('thumbnail', false); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Example data · Loading your data');
  });
  it('uses a KPI-specific preview height while preserving the full chart renderer', () => {
    const kpi = getDashboardChartCatalog().find(entry => entry.definition.category === 'kpi')!.tile;
    watch.mockReturnValue(of(buildDashboardExamplePreview(kpi)));
    const fixture = TestBed.createComponent(DashboardChartPreviewComponent);
    fixture.componentRef.setInput('user', { uid: 'example', settings: { unitSettings: {} } });
    fixture.componentRef.setInput('tile', kpi);
    fixture.componentRef.setInput('thumbnail', true); fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-tile-chart')).properties['previewMode']).toBe(true);
    expect(fixture.nativeElement.querySelector('.chart-preview-kpi')).not.toBeNull();
    fixture.componentRef.setInput('thumbnail', false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-preview-kpi')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-preview-thumbnail')).toBeNull();
  });

  it('keeps the same subscription when save state or theme changes, and releases it for data inputs and teardown', () => {
    const released = vi.fn();
    watch.mockReturnValue(new Observable(subscriber => {
      subscriber.next(buildDashboardExamplePreview(tile));
      return released;
    }));
    const fixture = TestBed.createComponent(DashboardChartPreviewComponent);
    fixture.componentRef.setInput('user', { uid: 'example', settings: { unitSettings: {} } });
    fixture.componentRef.setInput('tile', tile); fixture.detectChanges();
    for (const disabled of [true, false]) {
      fixture.componentRef.setInput('disabled', disabled);
      fixture.componentRef.setInput('darkTheme', disabled); fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('app-tile-chart')).properties['performanceControlsDisabled']).toBe(disabled);
    }
    expect(watch).toHaveBeenCalledTimes(1);
    expect(released).not.toHaveBeenCalled();
    fixture.componentRef.setInput('seed', { tiles: [] }); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(2);
    expect(released).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('tile', { ...tile, order: 2 }); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(3);
    expect(released).toHaveBeenCalledTimes(2);
    fixture.componentRef.setInput('user', { uid: 'another-owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(4);
    expect(released).toHaveBeenCalledTimes(3);
    fixture.componentRef.setInput('thumbnail', true); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(4);
    expect(released).toHaveBeenCalledTimes(4);
    fixture.componentRef.setInput('thumbnail', false); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(5);
    fixture.destroy();
    expect(released).toHaveBeenCalledTimes(5);
  });

  it('clears the previous owner preview when its required owner is removed', () => {
    const fixture = TestBed.createComponent(DashboardChartPreviewComponent);
    fixture.componentRef.setInput('user', { uid: 'example', settings: { unitSettings: {} } });
    fixture.componentRef.setInput('tile', tile); fixture.detectChanges();
    expect(fixture.componentInstance.preview()).not.toBeNull();
    fixture.componentRef.setInput('user', null); fixture.detectChanges();
    expect(fixture.componentInstance.preview()).toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-preview')).toBeNull();
  });
});
