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
import { ChartTypes, ChartDataValueTypes, ChartDataCategoryTypes } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';

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

    it('should call deleteTile logic directly', async () => {
        // Need 2 tiles to delete
        await component.deleteTile({} as any);
        expect(analyticsMock.logEvent).toHaveBeenCalledWith('dashboard_tile_action', { method: 'deleteTile' });
        expect(userMock.settings.dashboardSettings.tiles.length).toBe(1);
        expect(userMock.updateUserProperties).toHaveBeenCalled();
    });
});
