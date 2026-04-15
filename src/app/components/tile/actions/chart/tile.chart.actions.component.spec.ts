import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileChartActionsComponent } from './tile.chart.actions.component';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { TileActionsFooterComponent } from '../footer/tile.actions.footer.component';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { ChartTypes, ChartDataValueTypes, ChartDataCategoryTypes } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { DASHBOARD_RECOVERY_NOW_CHART_TYPE } from '../../../../helpers/dashboard-special-chart-types';

describe('TileChartActionsComponent', () => {
  let component: TileChartActionsComponent;
  let fixture: ComponentFixture<TileChartActionsComponent>;
  let userMock: any;
  let analyticsMock: any;

  beforeEach(async () => {
    userMock = {
      settings: {
        dashboardSettings: {
          dismissedCuratedRecoveryNowTile: false,
          tiles: [
            {
              order: 0,
              chartType: ChartTypes.Bar,
              dataType: 'Distance',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.ActivityType,
              size: { columns: 1, rows: 1 },
              type: 'Chart',
            },
            {
              order: 1,
              chartType: ChartTypes.Line,
              size: { columns: 1, rows: 1 },
              type: 'Chart',
            },
          ],
        },
      },
      updateUserProperties: vi.fn().mockResolvedValue(true),
    };

    analyticsMock = {
      logEvent: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [TileChartActionsComponent, TileActionsFooterComponent],
      imports: [
        MatMenuModule,
        MatSelectModule,
        MatIconModule,
        BrowserAnimationsModule,
        FormsModule,
      ],
      providers: [
        { provide: AppUserService, useValue: userMock },
        { provide: AppAnalyticsService, useValue: analyticsMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TileChartActionsComponent);
    component = fixture.componentInstance;
    component.user = userMock;
    component.order = 0;
    component.chartType = ChartTypes.Bar;
    component.size = { columns: 1, rows: 1 };
    component.type = 'Chart' as any;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should use form menu panel classes', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('should keep compact submenu panel classes for row and column size selects', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    const compactClassMatches = template.match(/panelClass="qs-config-submenu qs-config-submenu-compact"/g) ?? [];
    expect(compactClassMatches.length).toBe(2);
  });

  it('should remove chart data configuration controls and add-new action from the tile menu', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).not.toContain('app-tile-actions-header');
    expect(template).not.toContain('<mat-label>Type</mat-label>');
    expect(template).not.toContain('Chart type');
    expect(template).not.toContain('What data to look at');
    expect(template).not.toContain('How to look at the data');
    expect(template).not.toContain('Time interval');
    expect(template).toContain('Edit in Dashboard manager');
  });

  it('should emit editInDashboardManager with current tile order', () => {
    const emittedOrders: number[] = [];
    component.editInDashboardManager.subscribe((order) => emittedOrders.push(order));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    component.order = 1;
    component.openEditInDashboardManager({ preventDefault, stopPropagation } as any);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(emittedOrders).toEqual([1]);
  });

  it('should emit savingChange while persisting structural settings', async () => {
    const emittedStates: boolean[] = [];
    component.savingChange.subscribe(isSaving => emittedStates.push(isSaving));

    await component.changeTileColumnSize({ value: 2 } as any);

    expect(emittedStates).toEqual([true, false]);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });

  it('should expose move boundaries for the first tile', () => {
    expect(component.canMoveTileBackward()).toBe(false);
    expect(component.canMoveTileForward()).toBe(true);
  });

  it('should move a tile forward and persist the new order', async () => {
    await component.moveTileForward();

    expect(analyticsMock.logEvent).toHaveBeenCalledWith('dashboard_tile_action', { method: 'moveTileForward' });
    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1]);
    expect(userMock.settings.dashboardSettings.tiles[0].chartType).toBe(ChartTypes.Line);
    expect(userMock.settings.dashboardSettings.tiles[1].chartType).toBe(ChartTypes.Bar);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });

  it('should not persist when trying to move the first tile backward', async () => {
    await component.moveTileBackward();

    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1]);
    expect(userMock.settings.dashboardSettings.tiles[0].chartType).toBe(ChartTypes.Bar);
    expect(userMock.settings.dashboardSettings.tiles[1].chartType).toBe(ChartTypes.Line);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
  });

  it('should persist curated recovery tile dismissal when deleting it', async () => {
    userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = false;
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
        dataType: 'Recovery Time',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    component.chartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await component.deleteTile({} as any);

    expect(userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });
});
