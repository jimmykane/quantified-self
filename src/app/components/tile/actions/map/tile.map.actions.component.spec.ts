import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileMapActionsComponent } from './tile.map.actions.component';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { TileActionsFooterComponent } from '../footer/tile.actions.footer.component';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { TileTypes } from '@sports-alliance/sports-lib';

describe('TileMapActionsComponent', () => {
  let component: TileMapActionsComponent;
  let fixture: ComponentFixture<TileMapActionsComponent>;
  let userMock: any;
  let analyticsMock: any;

  beforeEach(async () => {
    userMock = {
      settings: {
        dashboardSettings: {
          tiles: [
            { type: TileTypes.Map, order: 0, mapStyle: 'default', clusterMarkers: false, size: { columns: 1, rows: 1 } },
            { type: TileTypes.Chart, order: 1, chartType: 'Pie', size: { columns: 1, rows: 1 } },
          ],
        },
      },
      updateUserProperties: vi.fn().mockResolvedValue(true),
    };

    analyticsMock = {
      logEvent: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [TileMapActionsComponent, TileActionsFooterComponent],
      imports: [
        MatMenuModule,
        MatSelectModule,
        MatIconModule,
        BrowserAnimationsModule,
      ],
      providers: [
        { provide: AppUserService, useValue: userMock },
        { provide: AppAnalyticsService, useValue: analyticsMock },
      ],
    })
      .compileComponents();

    fixture = TestBed.createComponent(TileMapActionsComponent);
    component = fixture.componentInstance;
    component.user = userMock;
    component.order = 0;
    component.size = { columns: 1, rows: 1 };
    component.type = TileTypes.Map as any;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should use form menu panel classes', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/map/tile.map.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('should use compact submenu panel classes for row and column size selects', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/map/tile.map.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    const compactClassMatches = template.match(/panelClass="qs-config-submenu qs-config-submenu-compact"/g) ?? [];
    expect(compactClassMatches.length).toBe(2);
  });

  it('should remove type and map setting controls from the map tile menu', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/map/tile.map.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).not.toContain('<mat-label>Type');
    expect(template).not.toContain('Map style');
    expect(template).not.toContain('Cluster markers');
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
    expect(userMock.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Chart);
    expect(userMock.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Map);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });

  it('should not persist when trying to move the first tile backward', async () => {
    await component.moveTileBackward();

    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1]);
    expect(userMock.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Map);
    expect(userMock.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Chart);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
  });
});
