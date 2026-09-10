import { MatMenuTrigger } from '@angular/material/menu';
import equal from 'fast-deep-equal';
import { DashboardConfigurationService, cloneDashboardSettings } from '../../../services/dashboard-configuration.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  TileSettingsInterface, TileTypes,
} from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import { AppUserService } from '../../../services/app.user.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { EventEmitter, Input, Output, Directive, ViewChild, inject } from '@angular/core';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppDashboardSettingsInterface } from '../../../models/app-user.interface';
import {
  type DashboardTileLaneKey,
  orderDashboardTilesByIntentSections,
  resolveDashboardTileLaneKey,
} from '../../../helpers/dashboard-tile-section.helper';

@Directive()
export class TileActionsAbstractDirective extends TileAbstractDirective {
  protected configurationService = inject(DashboardConfigurationService);
  private readonly snackBar = inject(MatSnackBar);
  protected pendingBaseline: AppDashboardSettingsInterface | null = null;
  public isSaving = false;
  @ViewChild(MatMenuTrigger) protected menuTrigger?: MatMenuTrigger;
  public restoreMenuFocus(): void { if (this.menuTrigger) this.menuTrigger.restoreFocus = true; }
  protected closeMenuForEditor(): void {
    if (this.menuTrigger) { this.menuTrigger.restoreFocus = false; this.menuTrigger.closeMenu(); }
  }
  protected captureDashboardBaseline(): void {
    this.pendingBaseline ??= cloneDashboardSettings(this.user.settings.dashboardSettings);
  }
  protected analyticsService = inject(AppAnalyticsService);
  protected hapticsService = inject(AppHapticsService);
  @Input() showLayoutControls = true;
  @Output() savingChange = new EventEmitter<boolean>();

  constructor(protected userService: AppUserService) {
    super();
  }

  protected async withSavingState<T>(operation: () => Promise<T>): Promise<T> {
    this.isSaving = true;
    this.savingChange.emit(true);
    try {
      return await operation();
    } finally {
      this.isSaving = false;
      this.savingChange.emit(false);
    }
  }

  protected async persistUserSettings(): Promise<unknown> {
    const dashboardSettingsPatch = cloneDashboardSettings(this.buildDashboardSettingsPersistencePatch());
    if (Object.keys(dashboardSettingsPatch).length === 0) {
      return this.withSavingState(() => Promise.resolve());
    }

    const baseline = this.pendingBaseline || cloneDashboardSettings(this.user.settings.dashboardSettings);
    this.pendingBaseline = null;
    return this.withSavingState(async () => {
      try {
        await this.configurationService.save(this.user.uid, baseline, dashboardSettingsPatch);
        this.hapticsService.success();
      } catch (error) {
        // Restore only our unchanged optimistic fields; a later local edit owns its own outcome.
        for (const key of Object.keys(dashboardSettingsPatch)) {
          if (equal(this.user.settings.dashboardSettings[key], dashboardSettingsPatch[key])) {
            if (baseline[key] === undefined) delete this.user.settings.dashboardSettings[key];
            else this.user.settings.dashboardSettings[key] = baseline[key];
          }
        }
        this.hapticsService.error();
        this.snackBar.open(error instanceof Error ? error.message : 'Could not save dashboard changes.', 'Dismiss', { duration: 6000 });
        throw error;
      }
    });
  }

  protected buildDashboardSettingsPersistencePatch(): Partial<AppDashboardSettingsInterface> {
    const dashboardSettings = this.user?.settings?.dashboardSettings as AppDashboardSettingsInterface | undefined;
    if (!dashboardSettings) {
      return {};
    }

    return {
      tiles: dashboardSettings.tiles || [],
    };
  }

  async changeTileType(_event) {
    if (this.isSaving) return;
    this.captureDashboardBaseline();
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileType' });
    const tileIndex = this.user.settings.dashboardSettings.tiles.findIndex(tile => tile.order === this.order);
    this.user.settings.dashboardSettings.tiles[tileIndex] = this.type === TileTypes.Map ? AppUserUtilities.getDefaultUserDashboardChartTile() : AppUserUtilities.getDefaultUserDashboardMapTile();
    this.user.settings.dashboardSettings.tiles[tileIndex].order = this.order;
    return this.persistUserSettings();
  }

  async changeTileColumnSize(event) {
    if (this.isSaving || this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)?.size.columns === event.value) return;
    this.captureDashboardBaseline();
    if (!this.showLayoutControls) {
      this.pendingBaseline = null;
      return;
    }
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileSize' });
    this.hapticsService.selection();
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.columns = event.value;
    return this.persistUserSettings();
  }

  async changeTileRowSize(event) {
    if (this.isSaving || this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)?.size.rows === event.value) return;
    this.captureDashboardBaseline();
    if (!this.showLayoutControls) {
      this.pendingBaseline = null;
      return;
    }
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileSize' });
    this.hapticsService.selection();
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.rows = event.value;
    return this.persistUserSettings();
  }

  async addNewTile(_event: MouseEvent) {
    if (this.isSaving) return;
    this.captureDashboardBaseline();
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'addNewTile' });
    const chart = Object.assign({}, (<TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)));
    chart.order = this.user.settings.dashboardSettings.tiles.length;
    this.user.settings.dashboardSettings.tiles.push(chart);
    return this.persistUserSettings();
  }

  async deleteTile(_event) {
    if (this.isSaving) return;
    this.captureDashboardBaseline();
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'deleteTile' });
    this.hapticsService.selection();
    const remainingTiles = this.getOrderedTiles().filter((chartSetting) => chartSetting.order !== this.order);
    this.user.settings.dashboardSettings.tiles = orderDashboardTilesByIntentSections(remainingTiles)
      .map((chartSetting, index) => ({ ...chartSetting, order: index }));
    return this.persistUserSettings();
  }

  canMoveTileBackward(): boolean {
    const orderedTiles = this.getOrderedTiles();
    const orderedLaneTiles = this.getOrderedLaneTiles(orderedTiles);
    const currentIndex = orderedLaneTiles.findIndex(tile => tile.order === this.order);
    return currentIndex > 0;
  }

  canMoveTileForward(): boolean {
    const orderedTiles = this.getOrderedTiles();
    const orderedLaneTiles = this.getOrderedLaneTiles(orderedTiles);
    const currentIndex = orderedLaneTiles.findIndex(tile => tile.order === this.order);
    return currentIndex >= 0 && currentIndex < orderedLaneTiles.length - 1;
  }

  async moveTileBackward() {
    return this.moveTileByOffset(-1, 'moveTileBackward');
  }

  async moveTileForward() {
    return this.moveTileByOffset(1, 'moveTileForward');
  }

  private async moveTileByOffset(offset: number, analyticsMethod: 'moveTileBackward' | 'moveTileForward') {
    const orderedTiles = this.getOrderedTiles();
    const orderedLaneTiles = this.getOrderedLaneTiles(orderedTiles);
    const currentIndex = orderedLaneTiles.findIndex(tile => tile.order === this.order);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedLaneTiles.length) {
      return;
    }

    if (this.isSaving) return;
    this.captureDashboardBaseline();
    this.hapticsService.selection();
    this.analyticsService.logEvent('dashboard_tile_action', { method: analyticsMethod });
    const currentTile = orderedLaneTiles[currentIndex];
    orderedLaneTiles[currentIndex] = orderedLaneTiles[targetIndex];
    orderedLaneTiles[targetIndex] = currentTile;
    const nextOrderedTiles = this.flattenTilesWithUpdatedLane(
      orderedTiles,
      this.getTileActionLaneKey(currentTile),
      orderedLaneTiles,
    );
    nextOrderedTiles.forEach((tile, index) => {
      tile.order = index;
    });

    this.user.settings.dashboardSettings.tiles = nextOrderedTiles;
    this.order = currentTile.order;
    return this.persistUserSettings();
  }

  private getOrderedTiles(): TileSettingsInterface[] {
    return [...(this.user?.settings?.dashboardSettings?.tiles || [])]
      .sort((left, right) => left.order - right.order);
  }

  private getOrderedLaneTiles(orderedTiles: TileSettingsInterface[]): TileSettingsInterface[] {
    const currentTile = orderedTiles.find(tile => tile.order === this.order);
    if (!currentTile) {
      return [];
    }

    const laneKey = this.getTileActionLaneKey(currentTile);
    return orderedTiles.filter(tile => this.getTileActionLaneKey(tile) === laneKey);
  }

  private flattenTilesWithUpdatedLane(
    orderedTiles: TileSettingsInterface[],
    updatedLaneKey: DashboardTileLaneKey,
    updatedLaneTiles: TileSettingsInterface[],
  ): TileSettingsInterface[] {
    let updatedLaneIndex = 0;
    return orderDashboardTilesByIntentSections(orderedTiles.map((tile) => {
      if (this.getTileActionLaneKey(tile) !== updatedLaneKey) {
        return tile;
      }

      const updatedTile = updatedLaneTiles[updatedLaneIndex];
      updatedLaneIndex += 1;
      return updatedTile || tile;
    }));
  }

  private getTileActionLaneKey(tile: TileSettingsInterface): DashboardTileLaneKey {
    return resolveDashboardTileLaneKey(tile);
  }

  /**
   * see https://github.com/angular/components/issues/11677
   */
  fixDisappearIOSBug() {
    this.hapticsService.selection();
    document.getElementById('panel-fix')?.remove();
    const styleNode = document.createElement('style');
    styleNode.type = 'text/css';
    styleNode.id = 'panel-fix';
    styleNode.appendChild(
      document.createTextNode('.mat-mdc-menu-panel,.mat-menu-panel{overflow: visible !important;}')
    );
    document.getElementsByTagName('head')[0].appendChild(styleNode);
    setTimeout(() => {
      styleNode.remove();
    }, 500);
  }
}
