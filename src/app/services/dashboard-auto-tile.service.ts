import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  TileSettingsInterface,
  TileTypes,
} from '@sports-alliance/sports-lib';
import { Subscription, take } from 'rxjs';
import {
  AppDashboardAutoTileState,
  AppDashboardChartTileDisplaySettingsInterface,
  AppDashboardChartTileSettingsInterface,
  AppDashboardMapTileSettingsInterface,
  AppDashboardSettingsInterface,
  AppDashboardTileEventFiltersInterface,
  AppUserInterface,
} from '../models/app-user.interface';
import {
  DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE,
  DASHBOARD_AUTO_TILE_CURATED_SOURCE,
  DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
  DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
  DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE,
  DASHBOARD_AUTO_TILE_KPI_SOURCE,
  DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID,
  buildDashboardCuratedAutoTile,
  buildDashboardKpiAutoTile,
  buildDashboardSleepTrendAutoTile,
  ensureDashboardAutoTiles,
  isDashboardCuratedAutoTile,
  isDashboardKpiAutoTile,
  isDashboardSleepTrendTile,
  markDashboardAutoTileAdded,
  markDashboardAutoTileDismissed,
  type DashboardDefaultCuratedChartType,
} from '../helpers/dashboard-auto-tile.helper';
import {
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  getDefaultDashboardKpiChartDefinitions,
  getDashboardCuratedChartDefinitions,
} from '../helpers/dashboard-special-chart-types';
import { cloneDashboardTileEventFilters } from '../helpers/dashboard-tile-event-filters.helper';
import { cloneDashboardChartTileDisplaySettingsForChartType } from '../helpers/dashboard-chart-display-settings.helper';
import { AppSleepService } from './app.sleep.service';
import { AppUserService } from './app.user.service';
import { LoggerService } from './logger.service';

export type DashboardAutoTileEligibility = Record<string, boolean | undefined>;

export interface DashboardAutoTileRule {
  id: string;
  label: string;
  source: string;
  qualifies: (eligibility: DashboardAutoTileEligibility) => boolean;
  isPresent: (tiles: readonly TileSettingsInterface[]) => boolean;
  createTile: (order: number) => TileSettingsInterface;
}

export interface DashboardAutoTileApplyResult {
  addedRules: DashboardAutoTileRule[];
  persisted: boolean;
}

const DASHBOARD_KPI_AUTO_TILE_RULES: DashboardAutoTileRule[] = getDefaultDashboardKpiChartDefinitions().map(definition => ({
  id: DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE[definition.chartType],
  label: definition.label,
  source: DASHBOARD_AUTO_TILE_KPI_SOURCE,
  qualifies: (eligibility) => eligibility[DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE[definition.chartType]] === true,
  isPresent: (tiles) => tiles.some(tile => isDashboardKpiAutoTile(tile, definition.chartType)),
  createTile: (order) => buildDashboardKpiAutoTile(definition.chartType, order),
}));

const DASHBOARD_DEFAULT_CURATED_AUTO_TILE_RULES: DashboardAutoTileRule[] = getDashboardCuratedChartDefinitions()
  .filter(definition => definition.chartType !== DASHBOARD_SLEEP_TREND_CHART_TYPE)
  .map((definition) => {
    const chartType = definition.chartType as DashboardDefaultCuratedChartType;
    return {
      id: DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE[chartType],
      label: buildDashboardCuratedAutoTile(chartType, 0).name,
      source: DASHBOARD_AUTO_TILE_CURATED_SOURCE,
      qualifies: (eligibility) => eligibility[DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE[chartType]] === true,
      isPresent: (tiles) => tiles.some(tile => isDashboardCuratedAutoTile(tile, chartType)),
      createTile: (order) => buildDashboardCuratedAutoTile(chartType, order),
    };
  });

export const DASHBOARD_AUTO_TILE_RULES: readonly DashboardAutoTileRule[] = [{
  id: DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
  label: 'Sleep',
  source: DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
  qualifies: (eligibility) => eligibility[DASHBOARD_AUTO_TILE_SLEEP_TREND_ID] === true,
  isPresent: (tiles) => tiles.some(tile => isDashboardSleepTrendTile(tile)),
  createTile: (order) => buildDashboardSleepTrendAutoTile(order),
}, ...DASHBOARD_DEFAULT_CURATED_AUTO_TILE_RULES, ...DASHBOARD_KPI_AUTO_TILE_RULES];

@Injectable({
  providedIn: 'root',
})
export class DashboardAutoTileService {
  private sleepService = inject(AppSleepService);
  private userService = inject(AppUserService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private applyingUserIDs = new Set<string>();
  private queuedAppliesByUserID = new Map<string, {
    user: AppUserInterface;
    eligibility: DashboardAutoTileEligibility;
    rules: readonly DashboardAutoTileRule[];
  }>();

  watchForDashboard(user: AppUserInterface | null | undefined): Subscription {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid || !user) {
      return new Subscription();
    }

    const eligibility = this.buildDefaultDashboardEligibility(user);
    const subscription = new Subscription();
    let isClosed = false;
    let applyScheduled = false;
    const scheduleApply = (): void => {
      if (isClosed || applyScheduled) {
        return;
      }

      applyScheduled = true;
      Promise.resolve().then(() => {
        applyScheduled = false;
        if (!isClosed) {
          void this.applyEligibleAutoTiles(user, { ...eligibility });
        }
      });
    };

    scheduleApply();

    subscription.add(this.sleepService.watchHasAnySleepSession(uid).subscribe({
      next: (hasSleepSession) => {
        eligibility[DASHBOARD_AUTO_TILE_SLEEP_TREND_ID] = hasSleepSession;
        scheduleApply();
      },
      error: (error) => {
        this.logger.warn('[DashboardAutoTileService] Failed to watch sleep auto-tile eligibility', error);
        scheduleApply();
      },
    }));
    subscription.add(() => {
      isClosed = true;
    });
    return subscription;
  }

  async applyEligibleAutoTiles(
    user: AppUserInterface,
    eligibility: DashboardAutoTileEligibility,
    rules: readonly DashboardAutoTileRule[] = DASHBOARD_AUTO_TILE_RULES,
  ): Promise<DashboardAutoTileApplyResult> {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return { addedRules: [], persisted: false };
    }

    if (this.applyingUserIDs.has(uid)) {
      this.queuedAppliesByUserID.set(uid, { user, eligibility, rules });
      return { addedRules: [], persisted: false };
    }

    const dashboardSettings = this.ensureDashboardSettings(user);
    const tiles = dashboardSettings.tiles || [];
    const autoTiles = ensureDashboardAutoTiles(dashboardSettings);
    const eligibleRules = rules.filter(rule => this.canApplyRule(rule, eligibility, tiles, autoTiles));
    if (!eligibleRules.length) {
      return { addedRules: [], persisted: false };
    }

    this.applyingUserIDs.add(uid);
    const previousTiles = this.cloneTiles(tiles);
    const previousAutoTiles = this.cloneAutoTiles(autoTiles);
    const previousDismissedRecoveryTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
    const nowMs = Date.now();

    try {
      let nextOrder = this.nextTileOrder(tiles);
      eligibleRules.forEach((rule) => {
        tiles.push(rule.createTile(nextOrder));
        markDashboardAutoTileAdded(dashboardSettings, rule.id, rule.source, nowMs);
        if (rule.id === DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID) {
          dashboardSettings.dismissedCuratedRecoveryNowTile = false;
        }
        nextOrder += 1;
      });
      dashboardSettings.tiles = tiles;

      await this.persistDashboardTileState(user, dashboardSettings);
      this.showAddedSnackbar(user, eligibleRules);
      return { addedRules: eligibleRules, persisted: true };
    } catch (error) {
      dashboardSettings.tiles = previousTiles;
      dashboardSettings.autoTiles = previousAutoTiles as AppDashboardSettingsInterface['autoTiles'];
      dashboardSettings.dismissedCuratedRecoveryNowTile = previousDismissedRecoveryTile;
      this.logger.error('[DashboardAutoTileService] Failed to add dashboard auto tiles', error);
      return { addedRules: [], persisted: false };
    } finally {
      this.applyingUserIDs.delete(uid);
      const queuedApply = this.queuedAppliesByUserID.get(uid);
      if (queuedApply) {
        this.queuedAppliesByUserID.delete(uid);
        void this.applyEligibleAutoTiles(queuedApply.user, queuedApply.eligibility, queuedApply.rules);
      }
    }
  }

  private canApplyRule(
    rule: DashboardAutoTileRule,
    eligibility: DashboardAutoTileEligibility,
    tiles: readonly TileSettingsInterface[],
    autoTiles: Record<string, AppDashboardAutoTileState | undefined>,
  ): boolean {
    const state = autoTiles[rule.id]?.state;
    return rule.qualifies(eligibility)
      && !rule.isPresent(tiles)
      && state !== 'dismissed'
      && state !== 'added';
  }

  private showAddedSnackbar(user: AppUserInterface, rules: readonly DashboardAutoTileRule[]): void {
    const snackBarRef = this.snackBar.open(this.formatAddedMessage(rules), 'Undo', {
      duration: 7000,
    });
    snackBarRef.onAction().pipe(take(1)).subscribe(() => {
      void this.undoAutoTileBatch(user, rules);
    });
  }

  private async undoAutoTileBatch(user: AppUserInterface, rules: readonly DashboardAutoTileRule[]): Promise<void> {
    const dashboardSettings = this.ensureDashboardSettings(user);
    const previousTiles = this.cloneTiles(dashboardSettings.tiles || []);
    const previousAutoTiles = this.cloneAutoTiles(ensureDashboardAutoTiles(dashboardSettings));
    const previousDismissedRecoveryTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
    const nowMs = Date.now();

    try {
      dashboardSettings.tiles = (dashboardSettings.tiles || [])
        .filter(tile => !rules.some(rule => rule.isPresent([tile])))
        .map((tile, index) => ({ ...tile, order: index }));
      rules.forEach((rule) => {
        markDashboardAutoTileDismissed(dashboardSettings, rule.id, rule.source, nowMs);
        if (rule.id === DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID) {
          dashboardSettings.dismissedCuratedRecoveryNowTile = true;
        }
      });
      await this.persistDashboardTileState(user, dashboardSettings);
    } catch (error) {
      dashboardSettings.tiles = previousTiles;
      dashboardSettings.autoTiles = previousAutoTiles as AppDashboardSettingsInterface['autoTiles'];
      dashboardSettings.dismissedCuratedRecoveryNowTile = previousDismissedRecoveryTile;
      this.logger.error('[DashboardAutoTileService] Failed to undo dashboard auto tiles', error);
      this.snackBar.open('Could not undo dashboard chart update', undefined, { duration: 3000 });
    }
  }

  private formatAddedMessage(rules: readonly DashboardAutoTileRule[]): string {
    if (rules.length === 1) {
      return `Added ${rules[0].label} chart to your dashboard.`;
    }

    const visibleLabels = rules.slice(0, 3).map(rule => rule.label);
    const remainingCount = rules.length - visibleLabels.length;
    const labelSummary = remainingCount > 0
      ? `${visibleLabels.join(', ')}, and ${remainingCount} more`
      : visibleLabels.join(', ');
    return `Added ${rules.length} dashboard charts: ${labelSummary}.`;
  }

  private persistDashboardTileState(
    user: AppUserInterface,
    dashboardSettings: AppDashboardSettingsInterface,
  ): Promise<void> {
    const dashboardSettingsPatch: Partial<AppDashboardSettingsInterface> = {
      tiles: dashboardSettings.tiles || [],
      autoTiles: dashboardSettings.autoTiles || {},
    };
    if (dashboardSettings.dismissedCuratedRecoveryNowTile !== undefined) {
      dashboardSettingsPatch.dismissedCuratedRecoveryNowTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
    }

    return this.userService.updateUserProperties(user, {
      settings: { dashboardSettings: dashboardSettingsPatch },
    });
  }

  private buildDefaultDashboardEligibility(user: AppUserInterface): DashboardAutoTileEligibility {
    return {
      ...this.buildDefaultCuratedEligibility(user),
      ...this.buildDefaultKpiEligibility(),
    };
  }

  private buildDefaultCuratedEligibility(user: AppUserInterface): DashboardAutoTileEligibility {
    const hasDismissedLegacyRecovery = user.settings?.dashboardSettings?.dismissedCuratedRecoveryNowTile === true;
    return getDashboardCuratedChartDefinitions()
      .filter(definition => definition.chartType !== DASHBOARD_SLEEP_TREND_CHART_TYPE)
      .reduce<DashboardAutoTileEligibility>((eligibility, definition) => {
        const chartType = definition.chartType as DashboardDefaultCuratedChartType;
        eligibility[DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE[chartType]] = (
          chartType !== DASHBOARD_RECOVERY_NOW_CHART_TYPE || !hasDismissedLegacyRecovery
        );
        return eligibility;
      }, {});
  }

  private buildDefaultKpiEligibility(): DashboardAutoTileEligibility {
    return getDefaultDashboardKpiChartDefinitions().reduce<DashboardAutoTileEligibility>((eligibility, definition) => {
      eligibility[DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE[definition.chartType]] = true;
      return eligibility;
    }, {});
  }

  private ensureDashboardSettings(user: AppUserInterface): AppDashboardSettingsInterface {
    user.settings = user.settings || {};
    user.settings.dashboardSettings = user.settings.dashboardSettings || {} as AppDashboardSettingsInterface;
    const dashboardSettings = user.settings.dashboardSettings as AppDashboardSettingsInterface;
    dashboardSettings.tiles = dashboardSettings.tiles || [];
    dashboardSettings.autoTiles = dashboardSettings.autoTiles || {};
    return dashboardSettings;
  }

  private nextTileOrder(tiles: readonly TileSettingsInterface[]): number {
    if (!tiles.length) {
      return 0;
    }
    return Math.max(...tiles.map(tile => Number(tile.order || 0))) + 1;
  }

  private cloneTiles(tiles: readonly TileSettingsInterface[]): TileSettingsInterface[] {
    return tiles.map((tile) => {
      const clonedTile = {
        ...tile,
        size: tile.size ? { ...tile.size } : tile.size,
      } as TileSettingsInterface & {
        eventFilters?: AppDashboardTileEventFiltersInterface;
        displaySettings?: AppDashboardChartTileDisplaySettingsInterface;
      };
      const eventFilters = cloneDashboardTileEventFilters(
        (tile as AppDashboardChartTileSettingsInterface | AppDashboardMapTileSettingsInterface).eventFilters,
      );
      if (eventFilters) {
        clonedTile.eventFilters = eventFilters;
      } else {
        delete clonedTile.eventFilters;
      }
      if (tile.type === TileTypes.Chart) {
        const chartTile = tile as AppDashboardChartTileSettingsInterface;
        const displaySettings = cloneDashboardChartTileDisplaySettingsForChartType(
          chartTile.chartType,
          chartTile.displaySettings,
        );
        if (displaySettings) {
          clonedTile.displaySettings = displaySettings;
        } else {
          delete clonedTile.displaySettings;
        }
      }
      return clonedTile as TileSettingsInterface;
    });
  }

  private cloneAutoTiles(
    autoTiles: Record<string, AppDashboardAutoTileState | undefined>,
  ): Partial<Record<string, AppDashboardAutoTileState>> {
    return Object.entries(autoTiles).reduce<Partial<Record<string, AppDashboardAutoTileState>>>((cloned, [id, state]) => {
      if (state) {
        cloned[id] = { ...state };
      }
      return cloned;
    }, {});
  }
}
