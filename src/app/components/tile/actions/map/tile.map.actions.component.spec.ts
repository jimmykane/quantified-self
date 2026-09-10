import { DashboardConfigurationService } from '../../../../services/dashboard-configuration.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileMapActionsComponent } from './tile.map.actions.component';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { AppHapticsService } from '../../../../services/app.haptics.service';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { TileTypes } from '@sports-alliance/sports-lib';

describe('TileMapActionsComponent', () => {
  let component: TileMapActionsComponent;
  let fixture: ComponentFixture<TileMapActionsComponent>;
  let userMock: any;
  let analyticsMock: any;
  let hapticsMock: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    userMock = {
      uid: 'owner',
      settings: {
        appSettings: { theme: 'dark' },
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          tiles: [
            { type: TileTypes.Map, order: 0, mapStyle: 'default', clusterMarkers: false, size: { columns: 1, rows: 1 } },
            { type: TileTypes.Map, order: 1, mapStyle: 'satellite', clusterMarkers: true, size: { columns: 1, rows: 1 } },
          ],
        },
      },
      updateUserProperties: vi.fn().mockResolvedValue(true),
    };

    analyticsMock = {
      logEvent: vi.fn(),
    };
    hapticsMock = {
      selection: vi.fn(), success: vi.fn(), error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [TileMapActionsComponent],
      imports: [
        MatMenuModule,
        MatIconModule,
        MatProgressSpinnerModule,
        BrowserAnimationsModule,
      ],
      providers: [
        { provide: DashboardConfigurationService, useValue: { save: (_uid, _expected, patch) => userMock.updateUserProperties(userMock, { settings: { dashboardSettings: patch } }) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: AppUserService, useValue: userMock },
        { provide: AppAnalyticsService, useValue: analyticsMock },
        { provide: AppHapticsService, useValue: hapticsMock },
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

  it('uses map wording and disables all actions while an open menu is saving', async () => {
    expect(hapticsMock.selection).not.toHaveBeenCalled();
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('Map actions');
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain('Edit map');
    expect(menu.textContent).toContain('Remove map');
    component.isSaving = true; fixture.detectChanges();
    expect(Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).every(button => button.disabled)).toBe(true);
    hapticsMock.selection.mockClear();
    const emitted = vi.spyOn(component.editTile, 'emit');
    component.openEditTile(new MouseEvent('click'));
    expect(emitted).not.toHaveBeenCalled();
    expect(hapticsMock.selection).not.toHaveBeenCalled();
  });
  it('includes Remove map in keyboard navigation and persists it once', async () => {
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
    hapticsMock.selection.mockClear();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', keyCode: 35, bubbles: true }));
    const remove = document.activeElement as HTMLButtonElement;
    expect(remove.textContent).toContain('Remove map');
    expect(hapticsMock.selection).not.toHaveBeenCalled();
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
    remove.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalledOnce();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    expect(hapticsMock.success).toHaveBeenCalledOnce();
    expect(hapticsMock.error).not.toHaveBeenCalled();
  });
  it.each([
    ['columns', 'Columns: 1', '2 columns'],
    ['rows', 'Rows: 1', '2 rows'],
  ])('opens %s with arrow keys and saves the selected size once', async (dimension, label, choice) => {
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', keyCode: 36, bubbles: true }));
    if (dimension === 'rows') menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
    expect(document.activeElement?.textContent).toContain(label);
    hapticsMock.selection.mockClear();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
    fixture.detectChanges(); await fixture.whenStable();
    const choices = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    expect(choices).toHaveLength(4);
    expect(choices[0].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(choices[0]);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    hapticsMock.selection.mockClear();
    choices.find(button => button.textContent?.includes(choice))!.click();
    fixture.detectChanges(); await fixture.whenStable();
    expect(userMock.settings.dashboardSettings.tiles[0].size[dimension]).toBe(2);
    expect(userMock.updateUserProperties).toHaveBeenCalledOnce();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    expect(hapticsMock.success).toHaveBeenCalledOnce();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should use form menu panel classes', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/tile-actions-menu.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('should remove type and map setting controls from the map tile menu', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/tile-actions-menu.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).not.toContain('<mat-label>Type');
    expect(template).not.toContain('Map style');
    expect(template).not.toContain('Cluster markers');
    expect(template).toContain('Edit');
  });

  it('should emit editTile with current tile order', () => {
    const emittedOrders: number[] = [];
    component.editTile.subscribe((order) => emittedOrders.push(order));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    component.order = 1;
    component.openEditTile({ preventDefault, stopPropagation } as any);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(emittedOrders).toEqual([1]);
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'])('shows progress until a layout save finishes with %s', async outcome => {
    let resolveSave!: () => void;
    let rejectSave!: (error: Error) => void;
    userMock.updateUserProperties.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
    }));
    const save = component.changeTileColumnSize({ value: 2 }).catch(error => error);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(trigger.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Saving dashboard changes');
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
    await component.changeTileRowSize({ value: 3 });
    expect(userMock.updateUserProperties).toHaveBeenCalledOnce();
    if (outcome === 'success') resolveSave();
    else rejectSave(new Error('Save failed'));
    await save;
    fixture.detectChanges();
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-busy')).toBe('false');
    expect(trigger.querySelector('[role="progressbar"]')).toBeNull();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    expect(hapticsMock.success).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
    expect(hapticsMock.error).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
  });

  it('should emit savingChange while persisting structural settings', async () => {
    const emittedStates: boolean[] = [];
    component.savingChange.subscribe(isSaving => emittedStates.push(isSaving));

    await component.changeTileColumnSize({ value: 2 } as any);

    expect(emittedStates).toEqual([true, false]);
    expect(userMock.updateUserProperties).toHaveBeenCalledWith(userMock, {
      settings: {
        dashboardSettings: {
          tiles: userMock.settings.dashboardSettings.tiles,
        },
      },
    });
    expect(userMock.updateUserProperties.mock.calls[0][1].settings.appSettings).toBeUndefined();
    expect(userMock.updateUserProperties.mock.calls[0][1].settings.unitSettings).toBeUndefined();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('omits layout choices for compact tiles and ignores resizing', async () => {
    component.showLayoutControls = false; fixture.detectChanges();
    fixture.nativeElement.querySelector('.tile-actions-trigger').click();
    fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector('[role="menu"]')!;
    expect(menu.textContent).not.toContain('Columns:');
    expect(menu.textContent).not.toContain('Rows:');
    expect(menu.textContent).toContain('Move earlier');
    hapticsMock.selection.mockClear();
    await component.changeTileColumnSize({ value: 3 });
    expect(userMock.settings.dashboardSettings.tiles[0].size.columns).toBe(1);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
    expect(hapticsMock.selection).not.toHaveBeenCalled();
  });

  it('should expose move boundaries for the first tile', () => {
    expect(component.canMoveTileBackward()).toBe(false);
    expect(component.canMoveTileForward()).toBe(true);
  });

  it('should move a tile forward and persist the new order', async () => {
    await component.moveTileForward();

    expect(analyticsMock.logEvent).toHaveBeenCalledWith('dashboard_tile_action', { method: 'moveTileForward' });
    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1]);
    expect(userMock.settings.dashboardSettings.tiles[0].mapStyle).toBe('satellite');
    expect(userMock.settings.dashboardSettings.tiles[1].mapStyle).toBe('default');
    expect(userMock.updateUserProperties).toHaveBeenCalled();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('should not move a map tile into another inferred dashboard section', async () => {
    userMock.settings.dashboardSettings.tiles = [
      { type: TileTypes.Map, order: 0, mapStyle: 'default', clusterMarkers: false, size: { columns: 1, rows: 1 } },
      { type: TileTypes.Chart, order: 1, chartType: 'Pie', size: { columns: 1, rows: 1 } },
    ];

    expect(component.canMoveTileForward()).toBe(false);

    await component.moveTileForward();

    expect(userMock.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Map);
    expect(userMock.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Chart);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
  });

  it('should not persist when trying to move the first tile backward', async () => {
    await component.moveTileBackward();

    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1]);
    expect(userMock.settings.dashboardSettings.tiles[0].mapStyle).toBe('default');
    expect(userMock.settings.dashboardSettings.tiles[1].mapStyle).toBe('satellite');
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
  });
});
