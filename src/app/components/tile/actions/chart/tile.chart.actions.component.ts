import { hasDashboardTileSettings, resolveDashboardTilePresentation } from '../../../../helpers/dashboard-tile-presentation.helper';
import { Component, Input, OnInit } from '@angular/core';
import {
  TileTypes,
  TileSettingsInterface,
  TileChartSettingsInterface,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';
import {
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  type DashboardChartType,
  isDashboardRecoveryNowChartType,
} from '../../../../helpers/dashboard-special-chart-types';
import {
  DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
  DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
  DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID,
  getDashboardAutoTileDescriptorForTile,
  isDashboardSleepTrendTile,
  markDashboardAutoTileDismissed,
} from '../../../../helpers/dashboard-auto-tile.helper';
import { AppDashboardAutoTileState, AppDashboardSettingsInterface } from '../../../../models/app-user.interface';

@Component({
  selector: 'app-tile-chart-actions',
  templateUrl: '../tile-actions-menu.html',
  styleUrls: ['../tile.actions.abstract.css'],
  providers: [],
  standalone: false
})
export class TileChartActionsComponent extends TileActionsAbstractDirective implements OnInit {
  private currentChartType: DashboardChartType;
  @Input() set chartType(value: DashboardChartType) {
    this.currentChartType = value;
    this.canConfigure = hasDashboardTileSettings({ type: TileTypes.Chart, chartType: value });
    this.presentation = resolveDashboardTilePresentation({ type: TileTypes.Chart, chartType: value });
  }
  get chartType(): DashboardChartType { return this.currentChartType; }
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes;
  @Input() chartTimeInterval: TimeIntervals;
  @Input() chartOrder: number;
  private persistAutoTileStateWithNextSave = false;

  constructor(
    userService: AppUserService) {
    super(userService);
  }

  override async deleteTile(event: unknown) {
    const dashboardTiles = this.user?.settings?.dashboardSettings?.tiles || [];
    if (this.isSaving || !dashboardTiles.some(tile => tile.order === this.order)) return;
    this.captureDashboardBaseline();

    const dashboardSettings = this.user.settings.dashboardSettings as AppDashboardSettingsInterface;
    const previousTiles = this.cloneTiles(dashboardTiles);
    const previousDismissedRecoveryTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
    const previousAutoTiles = this.cloneAutoTiles(dashboardSettings.autoTiles || {});
    const tile = dashboardTiles.find(candidate => candidate.order === this.order);
    const chartType = (tile as TileChartSettingsInterface | null)?.chartType || this.chartType;
    const autoTileDescriptor = getDashboardAutoTileDescriptorForTile(tile);
    if (isDashboardRecoveryNowChartType(chartType) || autoTileDescriptor?.id === DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID) {
      dashboardSettings.dismissedCuratedRecoveryNowTile = true;
      this.persistAutoTileStateWithNextSave = true;
    }
    if (autoTileDescriptor || isDashboardSleepTrendTile(tile) || `${chartType}` === DASHBOARD_SLEEP_TREND_CHART_TYPE) {
      markDashboardAutoTileDismissed(
        dashboardSettings,
        autoTileDescriptor?.id || DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
        autoTileDescriptor?.source || DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
        Date.now(),
      );
      this.persistAutoTileStateWithNextSave = true;
    }
    try {
      return await super.deleteTile(event);
    } catch (error) {
      dashboardSettings.tiles = previousTiles;
      dashboardSettings.dismissedCuratedRecoveryNowTile = previousDismissedRecoveryTile;
      dashboardSettings.autoTiles = previousAutoTiles as AppDashboardSettingsInterface['autoTiles'];
      throw error;
    } finally {
      this.persistAutoTileStateWithNextSave = false;
    }
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }

  private cloneTiles(tiles: TileSettingsInterface[]): TileSettingsInterface[] {
    return (tiles || []).map(tile => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size,
    } as TileSettingsInterface));
  }

  protected override buildDashboardSettingsPersistencePatch(): Partial<AppDashboardSettingsInterface> {
    const dashboardSettings = this.user?.settings?.dashboardSettings as AppDashboardSettingsInterface | undefined;
    const patch = super.buildDashboardSettingsPersistencePatch();
    if (!dashboardSettings || !this.persistAutoTileStateWithNextSave) {
      return patch;
    }

    if (dashboardSettings.autoTiles) {
      patch.autoTiles = dashboardSettings.autoTiles;
    }
    if (dashboardSettings.dismissedCuratedRecoveryNowTile !== undefined) {
      patch.dismissedCuratedRecoveryNowTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
    }
    return patch;
  }

  private cloneAutoTiles(
    autoTiles: Partial<Record<string, AppDashboardAutoTileState>>,
  ): Partial<Record<string, AppDashboardAutoTileState>> {
    return Object.entries(autoTiles).reduce<Partial<Record<string, AppDashboardAutoTileState>>>((cloned, [id, state]) => {
      if (state) {
        cloned[id] = { ...state };
      }
      return cloned;
    }, {});
  }
}
