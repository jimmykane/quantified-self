import { ChangeDetectionStrategy, Component, DestroyRef, Input, computed, effect, inject, input, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';

type PerformanceTabId = 'intensity' | 'powerCurve' | 'durability' | 'cadencePower';
let nextContentId = 0;

@Component({
  selector: 'app-event-performance-charts',
  templateUrl: './event.performance-charts.component.html',
  styleUrls: ['./event.performance-charts.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventPerformanceChartsComponent {
  readonly viewer = input<User | null>(null);
  readonly contentId = `event-performance-charts-${nextContentId++}`;
  private readonly settings = inject(AppUserSettingsQueryService);
  private readonly haptics = inject(AppHapticsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly visibilityOverride = signal<{ viewerID: string | null; shown: boolean } | null>(null);
  private readonly pendingSave = signal<{ viewerID: string; shown: boolean } | null>(null);
  readonly saving = computed(() => !!this.pendingSave() && this.pendingSave()?.viewerID === this.viewer()?.uid);
  readonly expanded = computed(() => {
    const viewerID = this.viewer()?.uid ?? null;
    const override = this.visibilityOverride();
    return override?.viewerID === viewerID ? override.shown
      : !viewerID || this.settings.chartSettings()?.showPerformanceCharts !== false;
  });
  private selectedTab: PerformanceTabId | null = null;

  constructor() {
    effect(() => {
      const viewerID = this.viewer()?.uid ?? null;
      const override = this.visibilityOverride();
      if (override && override.viewerID !== viewerID) this.visibilityOverride.set(null);
      const pending = this.pendingSave();
      if (pending && pending.viewerID !== viewerID) this.pendingSave.set(null);
      if (viewerID && !this.saving() && override?.viewerID === viewerID
        && override.shown === (this.settings.chartSettings()?.showPerformanceCharts !== false)) {
        this.visibilityOverride.set(null);
      }
    });
  }

  async toggleExpanded(): Promise<void> {
    if (this.destroyRef.destroyed || this.saving() || !this.availableTabs.length) return;
    const viewerID = this.viewer()?.uid ?? null;
    const shown = !this.expanded();
    this.visibilityOverride.set({ viewerID, shown });
    this.haptics.selection();
    // Anonymous viewers can collapse their view without writing the shared owner's settings.
    if (!viewerID) return;
    const request = { viewerID, shown };
    this.pendingSave.set(request);
    const stillCurrent = () => !this.destroyRef.destroyed && this.pendingSave() === request && this.viewer()?.uid === viewerID;
    try {
      await this.settings.updateChartSettings({ showPerformanceCharts: shown }, { force: true, expectedUserID: viewerID });
      if (stillCurrent()) this.haptics.success();
    } catch {
      if (stillCurrent()) {
        this.visibilityOverride.set(null);
        this.haptics.error();
        this.snackBar.open('Could not save performance chart visibility. Please try again.', 'OK', { duration: 5000 });
      }
    } finally {
      if (this.pendingSave() === request) this.pendingSave.set(null);
    }
  }

  get activeTab(): PerformanceTabId | null {
    return this.availableTabs.includes(this.selectedTab) ? this.selectedTab : this.availableTabs[0] ?? null;
  }

  selectChart(tab: PerformanceTabId): void {
    if (this.destroyRef.destroyed || this.saving() || !this.expanded() || !this.availableTabs.includes(tab)) return;
    const changed = tab !== this.activeTab;
    this.selectedTab = tab;
    if (changed) this.haptics.selection();
  }

  @Input() activities: ActivityInterface[] = [];
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() isMerge = false;

  @Input() hasIntensity = false;
  @Input() hasPowerCurve = false;
  @Input() hasDurability = false;
  @Input() durabilityOutputUnavailable = false;
  @Input() hasCadencePower = false;

  get chartTitles(): string[] {
    return this.availableTabs.map(tab => tab === 'intensity' ? 'Intensity Zones' : this.getTabLabel(tab));
  }

  get chartOptions(): { id: PerformanceTabId; label: string; icon: string }[] {
    return this.availableTabs.map(id => ({ id, label: this.getTabLabel(id), icon: this.getTabIcon(id) }));
  }

  get disclosureLabel(): string { return `${this.expanded() ? 'Hide' : 'Show'} performance charts`; }

  get shouldShowTabs(): boolean {
    return this.availableTabs.length > 1;
  }

  get availableTabs(): PerformanceTabId[] {
    const tabs: PerformanceTabId[] = [];
    if (this.hasIntensity) {
      tabs.push('intensity');
    }
    if (this.hasPowerCurve) {
      tabs.push('powerCurve');
    }
    if (this.hasDurability) {
      tabs.push('durability');
    }
    if (this.hasCadencePower) {
      tabs.push('cadencePower');
    }
    return tabs;
  }

  getTabLabel(tab: PerformanceTabId): string {
    if (tab === 'intensity') {
      return 'Intensity';
    }
    if (tab === 'powerCurve') {
      return 'Power Curve';
    }
    if (tab === 'durability') {
      return 'Durability';
    }
    return 'Cadence vs Power';
  }

  getTabIcon(tab: PerformanceTabId): string {
    if (tab === 'intensity') {
      return 'stacked_bar_chart';
    }
    if (tab === 'powerCurve') {
      return 'line_curve';
    }
    if (tab === 'durability') {
      return 'line_axis';
    }
    return 'key_visualizer';
  }
}
