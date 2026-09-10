import { resolveDashboardTilePresentation } from '../../../helpers/dashboard-tile-presentation.helper';
import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, Subject } from 'rxjs';
import { TileSettingsInterface } from '@sports-alliance/sports-lib';
import { AppUserInterface, AppDashboardSettingsInterface } from '../../../models/app-user.interface';
import { DashboardConfigurationService, cloneDashboardSettings, assertDashboardConfigurationCurrent } from '../../../services/dashboard-configuration.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppSleepService } from '../../../services/app.sleep.service';
import { AppRouteService } from '../../../services/app.route.service';
import { DashboardDerivedMetricsService } from '../../../services/dashboard-derived-metrics.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { DashboardTileLaneKey, resolveDashboardTileLaneKey } from '../../../helpers/dashboard-tile-section.helper';
import { DashboardChartCatalogEntry } from '../../../helpers/dashboard-chart-catalog.helper';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { DashboardTileConfiguration } from './dashboard-tile-configuration';

@Injectable()
export class DashboardChartLibraryState implements OnDestroy {
  private readonly persistence = inject(DashboardConfigurationService);
  private readonly dialog = inject(MatDialog);
  readonly haptics = inject(AppHapticsService);
  private readonly events = inject(AppEventService);
  private readonly sleep = inject(AppSleepService);
  private readonly routes = inject(AppRouteService);
  private readonly derived = inject(DashboardDerivedMetricsService);
  readonly activeLane = signal<DashboardTileLaneKey | null>(null);
  readonly selected = signal<DashboardChartCatalogEntry | null>(null);
  readonly draft = signal<TileSettingsInterface | null>(null);
  readonly editor = signal<DashboardTileConfiguration | null>(null);
  readonly configuring = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly undoAvailable = signal(false);
  readonly changed$ = new Subject<number | null>();
  private initialDraft = '';
  private originalTile: TileSettingsInterface | null = null;
  private undoState: { uid: string; before: AppDashboardSettingsInterface; after: AppDashboardSettingsInterface } | null = null;
  private confirming = false;
  private mutationVersion = 0;
  private contextVersion = 0;

  ngOnDestroy(): void { this.resetContext(); this.changed$.complete(); }
  resetContext(): void {
    this.contextVersion++; this.clearSelection(); this.activeLane.set(null); this.undoState = null; this.undoAvailable.set(false);
  }

  async open(lane: DashboardTileLaneKey): Promise<void> {
    if (this.busy() || !(await this.canDiscard())) return;
    this.haptics.selection();
    const next = this.activeLane() === lane ? null : lane;
    this.clearSelection();
    this.activeLane.set(next);
  }

  async close(): Promise<void> {
    if (this.busy() || !(await this.canDiscard())) return;
    this.haptics.selection();
    this.clearSelection();
    this.activeLane.set(null);
  }

  async select(user: AppUserInterface, entry: DashboardChartCatalogEntry, feedback = true): Promise<boolean> {
    if (this.busy() || this.selected()?.definition.id === entry.definition.id || !(await this.canDiscard())) return false;
    if (feedback) this.haptics.selection();
    this.clearSelection();
    this.selected.set(entry);
    this.createEditor(user, entry.tile, false);
    return true;
  }

  /** Filtering may release a preview, but must never discard edits or interrupt a save. */
  clearPreview(): void {
    if (this.busy() || this.configuring() || this.hasChanges()) return;
    this.clearSelection();
  }

  async createCustom(user: AppUserInterface): Promise<void> {
    if (this.busy() || !(await this.canDiscard())) return;
    this.haptics.selection();
    this.clearSelection();
    this.activeLane.set('section:activityOverview');
    this.createEditor(user, AppUserUtilities.getDefaultUserDashboardChartTile(), false);
    this.configuring.set(true);
  }

  async edit(user: AppUserInterface, order: number): Promise<void> {
    if (this.busy() || !(await this.canDiscard())) return;
    const tile = user.settings.dashboardSettings.tiles.find(candidate => candidate.order === order);
    if (!tile) return;
    this.clearSelection();
    this.activeLane.set(resolveDashboardTileLaneKey(tile));
    this.createEditor(user, tile, true);
    this.configuring.set(true);
  }

  configure(): void { if (!this.configuring()) { this.haptics.selection(); this.configuring.set(true); } }

  async back(): Promise<void> {
    if (this.busy()) return;
    if (this.configuring()) {
      this.haptics.selection();
      this.configuring.set(false);
      return;
    }
    if (this.busy() || !(await this.canDiscard())) return;
    this.haptics.selection();
    this.clearSelection();
  }

  refreshDraft(): void {
    const editor = this.editor();
    if (!editor) return;
    const original = this.originalTile;
    this.draft.set(editor.buildPreviewTile(original?.order || 0, original?.size || { columns: 1, rows: 1 }, editor.mode === 'edit' ? original : null));
  }

  async save(): Promise<void> {
    const editor = this.editor();
    if (this.busy() || !editor || editor.isSaveDisabled) return;
    const contextVersion = this.contextVersion;
    this.haptics.selection(); this.busy.set(true); this.error.set('');
    try { await editor.save(); if (contextVersion === this.contextVersion) this.error.set(editor.saveError); }
    finally { this.busy.set(false); }
  }

  async bulk(user: AppUserInterface, action: 'today' | 'reset' | 'all' | 'clear'): Promise<void> {
    if (this.busy() || !(await this.canDiscard())) return;
    this.busy.set(true); this.error.set('');
    const mutationVersion = this.mutationVersion;
    const contextVersion = this.contextVersion;
    const editor = this.makeController(user, false);
    try {
      if (action === 'today') await editor.onTodaySummaryVisibilityChange(user.settings.dashboardSettings.showTodaySummary === false);
      if (action === 'reset') await editor.resetToDefault();
      if (action === 'all') await editor.addAllTiles();
      if (action === 'clear') await editor.removeAllTiles();
      if (contextVersion !== this.contextVersion) return;
      this.error.set(editor.saveError);
      if (mutationVersion !== this.mutationVersion) { this.clearSelection(); this.activeLane.set(null); }
    } finally { editor.destroy(); this.busy.set(false); }
  }

  async undo(user: AppUserInterface): Promise<void> {
    const undo = this.undoState;
    const contextVersion = this.contextVersion;
    if (!undo || !this.undoAvailable() || this.busy() || undo.uid !== user.uid) return;
    if (!(await this.canDiscard()) || this.busy() || contextVersion !== this.contextVersion || undo !== this.undoState) return;
    this.haptics.selection(); this.busy.set(true); this.error.set('');
    try {
      assertDashboardConfigurationCurrent(user.settings.dashboardSettings, undo.after, Object.keys(undo.after));
      const restored = cloneDashboardSettings(undo.before);
      restored.tiles ??= [];
      const controller = this.makeController(user, false);
      controller.syncAutoTileStateAfterSave(restored, undo.after.tiles, restored.tiles);
      controller.destroy();
      await this.persistence.save(user.uid, undo.after, restored);
      if (contextVersion !== this.contextVersion) return;
      user.settings.dashboardSettings = { ...user.settings.dashboardSettings, ...restored };
      this.clearSelection(); this.activeLane.set(null);
      this.undoAvailable.set(false); this.changed$.next(null); this.haptics.success();
    } catch (error) { if (contextVersion === this.contextVersion) { this.error.set(error instanceof Error ? error.message : 'Could not undo the addition.'); this.haptics.error(); } }
    finally { this.busy.set(false); }
  }

  invalidateUndo(settings: AppDashboardSettingsInterface): void {
    if (!this.undoState || !this.undoAvailable()) return;
    try { assertDashboardConfigurationCurrent(settings, this.undoState.after, Object.keys(this.undoState.after)); }
    catch { this.undoAvailable.set(false); }
  }

  private createEditor(user: AppUserInterface, tile: TileSettingsInterface, editing: boolean): void {
    const controller = this.makeController(user, !editing);
    controller.mode = editing ? 'edit' : 'add';
    controller.editTileOrder = editing ? tile.order : null;
    controller.syncFormStateFromTile(tile);
    controller.activeWorkflowTab = 'manual';
    this.editor.set(controller);
    this.originalTile = JSON.parse(JSON.stringify(tile));
    this.refreshDraft();
    this.initialDraft = JSON.stringify(this.draft());
  }

  private makeController(user: AppUserInterface, allowUndo: boolean): DashboardTileConfiguration {
    const contextVersion = this.contextVersion;
    const baseline = cloneDashboardSettings(user.settings.dashboardSettings);
    const draftUser = { ...user, settings: { ...user.settings, dashboardSettings: cloneDashboardSettings(baseline) } } as AppUserInterface;
    const controller: DashboardTileConfiguration = new DashboardTileConfiguration({ user: draftUser }, { close: result => {
      if (result.saved && contextVersion === this.contextVersion) { this.clearSelection(); this.activeLane.set(null); }
    } }, this.dialog, { updateUserProperties: async (_user, change) => {
      const patch = change.settings.dashboardSettings;
      await this.persistence.save(user.uid, baseline, patch);
      if (contextVersion !== this.contextVersion) return;
      this.mutationVersion++;
      user.settings.dashboardSettings = { ...user.settings.dashboardSettings, ...patch };
      const order = controller.mode === 'add' && controller.savingAction === 'save' ? user.settings.dashboardSettings.tiles.at(-1)?.order ?? null : controller.editTileOrder;
      // Undo owns the same fields as the chart write. Event-table filters can have
      // newer local dates than storage and must neither block Undo nor be rolled back.
      this.undoState = allowUndo ? {
        uid: user.uid,
        before: cloneDashboardSettings(Object.fromEntries(Object.keys(patch).map(key => [key, baseline[key]]))),
        after: cloneDashboardSettings(patch),
      } : null;
      this.undoAvailable.set(allowUndo);
      this.changed$.next(order);
    } }, this.haptics, this.sleep, this.events, this.routes, this.derived);
    controller.initialize();
    return controller;
  }

  private clearSelection(): void {
    this.editor()?.destroy(); this.editor.set(null); this.draft.set(null); this.selected.set(null); this.configuring.set(false); this.error.set(''); this.initialDraft = ''; this.originalTile = null;
  }

  private hasChanges(): boolean {
    return !!this.editor() && JSON.stringify(this.draft()) !== this.initialDraft;
  }

  private async canDiscard(): Promise<boolean> {
    if (this.confirming) return false;
    if (!this.hasChanges()) return true;
    this.confirming = true;
    const contextVersion = this.contextVersion;
    try {
      return await firstValueFrom(this.dialog.open(ConfirmationDialogComponent, { data: {
        title: `Discard ${resolveDashboardTilePresentation(this.draft()).singular} changes?`, message: 'Your changes have not been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing',
      } }).afterClosed()) === true && contextVersion === this.contextVersion;
    } finally { this.confirming = false; }
  }
}
