import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileChartActionsComponent } from './tile.chart.actions.component';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { TileActionsHeaderComponent } from '../header/tile.actions.header.component';
import { TileActionsFooterComponent } from '../footer/tile.actions.footer.component';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { ChartTypes, ChartDataValueTypes, ChartDataCategoryTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import {
    DASHBOARD_FORM_CHART_TYPE,
    DASHBOARD_RECOVERY_NOW_CHART_TYPE,
} from '../../../../helpers/dashboard-special-chart-types';

describe('TileChartActionsComponent', () => {
    let component: TileChartActionsComponent;
    let fixture: ComponentFixture<TileChartActionsComponent>;
    let userMock: any;
    let analyticsMock: any;

    beforeEach(async () => {
        userMock = {
            settings: {
                dashboardSettings: {
                    tiles: [
                        {
                            order: 0,
                            chartType: ChartTypes.Bar,
                            dataType: 'Distance',
                            dataValueType: ChartDataValueTypes.Total,
                            dataCategoryType: ChartDataCategoryTypes.ActivityType,
                            size: { columns: 1, rows: 1 }
                        },
                        { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 } }
                    ],
                    unitSettings: {
                        speedUnits: ['km/h']
                    }
                }
            },
            updateUserProperties: vi.fn().mockResolvedValue(true)
        };

        analyticsMock = {
            logEvent: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [TileChartActionsComponent, TileActionsHeaderComponent, TileActionsFooterComponent],
            imports: [
                MatMenuModule,
                MatSelectModule,
                MatIconModule,
                BrowserAnimationsModule,
                FormsModule
            ],
            providers: [
                { provide: AppUserService, useValue: userMock },
                { provide: AppAnalyticsService, useValue: analyticsMock }
            ]
        })
            .compileComponents();

        fixture = TestBed.createComponent(TileChartActionsComponent);
        component = fixture.componentInstance;
        component.user = userMock;
        component.order = 0;
        component.chartType = ChartTypes.Bar;
        component.size = { columns: 1, rows: 1 };
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

    it('should use compact submenu panel classes for row and column size selects', () => {
        const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
        const template = readFileSync(templatePath, 'utf8');
        const compactClassMatches = template.match(/panelClass="qs-config-submenu qs-config-submenu-compact"/g) ?? [];
        expect(compactClassMatches.length).toBe(2);
    });

    it('should call deleteTile logic directly', async () => {
        // Need 2 tiles to delete
        await component.deleteTile({} as any);
        expect(analyticsMock.logEvent).toHaveBeenCalledWith('dashboard_tile_action', { method: 'deleteTile' });
        expect(userMock.settings.dashboardSettings.tiles.length).toBe(1);
        expect(userMock.updateUserProperties).toHaveBeenCalled();
    });

    it('should emit savingChange while persisting chart settings', async () => {
        const emittedStates: boolean[] = [];
        component.savingChange.subscribe(isSaving => emittedStates.push(isSaving));

        await component.changeChartDataType({ value: 'Duration' } as any);

        expect(emittedStates).toEqual([true, false]);
        expect(userMock.updateUserProperties).toHaveBeenCalled();
    });

    it('should exclude deprecated chart types from chart type options', () => {
        expect(component.chartTypeOptions.some(option => /^bri.*dev/i.test(option))).toBe(false);
        expect(component.chartTypeOptions.some(option => /^spiral$/i.test(option))).toBe(false);
    });

    it('should expose curated recovery chart type in chart type options', () => {
        expect(component.chartTypeOptions).toContain(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
    });

    it('should expose form chart type in chart type options', () => {
        expect(component.chartTypeOptions).toContain(DASHBOARD_FORM_CHART_TYPE);
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
                size: { columns: 1, rows: 1 }
            },
            { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 } }
        ];
        component.chartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE as any;
        component.order = 0;
        fixture.detectChanges();

        await component.deleteTile({} as any);

        expect(userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
        expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
        expect(userMock.updateUserProperties).toHaveBeenCalled();
    });

    it('should normalize chart fields when switched to curated recovery chart type', async () => {
        userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = true;
        component.order = 0;

        await component.changeChartType({ value: DASHBOARD_RECOVERY_NOW_CHART_TYPE } as any);

        const updatedTile = userMock.settings.dashboardSettings.tiles[0];
        expect(updatedTile.chartType).toBe(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
        expect(updatedTile.name).toBe('Recovery');
        expect(updatedTile.dataType).toBe('Recovery Time');
        expect(updatedTile.dataCategoryType).toBe(ChartDataCategoryTypes.DateType);
        expect(updatedTile.dataValueType).toBe(ChartDataValueTypes.Total);
        expect(userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(false);
        expect(userMock.updateUserProperties).toHaveBeenCalled();
    });

    it('should normalize chart fields when switched to form chart type', async () => {
        userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = true;
        component.order = 0;

        await component.changeChartType({ value: DASHBOARD_FORM_CHART_TYPE } as any);

        const updatedTile = userMock.settings.dashboardSettings.tiles[0];
        expect(updatedTile.chartType).toBe(DASHBOARD_FORM_CHART_TYPE);
        expect(updatedTile.name).toBe('Form');
        expect(updatedTile.dataType).toBe('Training Stress Score');
        expect(updatedTile.dataCategoryType).toBe(ChartDataCategoryTypes.DateType);
        expect(updatedTile.dataValueType).toBe(ChartDataValueTypes.Total);
        expect(updatedTile.dataTimeInterval).toBe(TimeIntervals.Daily);
        expect(userMock.updateUserProperties).toHaveBeenCalled();
    });

    it('should hide form-incompatible controls for the form chart mode', () => {
        const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
        const template = readFileSync(templatePath, 'utf8');

        expect(template).toContain('!isCuratedRecoveryNowChart && !isFormChart');
    });
});
