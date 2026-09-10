import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
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
});
