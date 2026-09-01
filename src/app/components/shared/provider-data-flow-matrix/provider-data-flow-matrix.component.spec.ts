import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderDataFlowMatrixComponent } from './provider-data-flow-matrix.component';
import {
  buildProviderDataFlowSummary,
  buildPublicProviderDataFlowRows,
} from './provider-data-flow-matrix.helper';

describe('ProviderDataFlowMatrixComponent', () => {
  let fixture: ComponentFixture<ProviderDataFlowMatrixComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProviderDataFlowMatrixComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ProviderDataFlowMatrixComponent);
  });

  it('builds the public capability grid from the production activity and route registries', () => {
    const rows = buildPublicProviderDataFlowRows();
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('interactive', false);
    fixture.componentRef.setInput('showRouteState', false);
    fixture.detectChanges();

    const garminRow = rows.find(row => row.sourceServiceName === ServiceNames.GarminAPI);
    const suuntoRow = rows.find(row => row.sourceServiceName === ServiceNames.SuuntoApp);
    const text = fixture.nativeElement.textContent as string;

    expect(garminRow?.cells.find(cell => cell.destinationServiceName === ServiceNames.SuuntoApp)?.routes
      .map(route => route.kind)).toEqual(['activity']);
    expect(suuntoRow?.cells.find(cell => cell.destinationServiceName === ServiceNames.GarminAPI)?.routes
      .map(route => route.kind)).toEqual(['route']);
    expect(text).toContain('Garmin');
    expect(text).toContain('Suunto');
    expect(text).toContain('COROS');
    expect(text).toContain('Wahoo');
    expect(text).toContain('Activity');
    expect(text).toContain('Route');
    expect(text).not.toContain('Available');
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders only the compact table instead of duplicating the responsive matrix', () => {
    fixture.componentRef.setInput('rows', buildPublicProviderDataFlowRows());
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.provider-data-flow-matrix__table')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.provider-data-flow-matrix__mobile')).toBeNull();
  });

  it('emits the selected live route and preserves active connection state', () => {
    const summary = buildProviderDataFlowSummary({
      uid: 'test-user',
      serviceConnectionState: {
        garmin: true,
        suunto: true,
        coros: false,
        wahoo: false,
      },
      activityRouteSettings: {
        GarminAPI_to_SuuntoApp: { enabled: true },
      },
    });
    const selectedRoutes: string[] = [];
    fixture.componentRef.setInput('rows', summary.matrixRows);
    fixture.componentInstance.routeSelect.subscribe(route => selectedRoutes.push(route.id));
    fixture.detectChanges();

    const activeRoute = fixture.nativeElement.querySelector(
      '.provider-data-flow-matrix__route--active',
    ) as HTMLButtonElement;
    activeRoute.click();

    expect(activeRoute.textContent).toContain('On');
    expect(selectedRoutes).toEqual(['activity-GarminAPI_to_SuuntoApp']);
    expect(fixture.nativeElement.querySelectorAll(
      'thead .provider-data-flow-matrix__provider-status',
    )).toHaveLength(2);
  });
});
