import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { HEALTH_PROVIDERS, type HealthProvider } from '@shared/health';
import type { ProviderPresentation } from '@shared/provider-presentation';
import { SharedModule } from '../../modules/shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';

export interface HealthSourceSyncView {
  statusLabel: string;
  statusTooltip: string;
  lastUpdateText: string;
  lastUpdateDateTime: string | null;
  tone: 'current' | 'delayed' | 'stale' | 'error' | 'neutral';
}

export interface HealthWorkspaceSourceOption {
  provider: HealthProvider;
  label: string;
  selected: boolean;
  presentation: ProviderPresentation | null;
  sync: HealthSourceSyncView | null;
  /** null means the selected metric's availability has not settled yet. */
  hasDataInView: boolean | null;
}

export interface HealthSourcesData {
  providers: readonly HealthWorkspaceSourceOption[];
  syncStatus: 'loading' | 'ready' | 'denied' | 'error';
}

export interface HealthSourcesResult {
  /** null leaves the filter untouched; [] explicitly chooses every source. */
  providers: HealthProvider[] | null;
}

@Component({
  selector: 'app-health-sources-bottom-sheet',
  standalone: true,
  imports: [SharedModule, ServiceSourceIconComponent],
  templateUrl: './health-sources-bottom-sheet.component.html',
  styleUrls: ['./health-sources-bottom-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSourcesBottomSheetComponent {
  readonly data = inject<HealthSourcesData>(MAT_BOTTOM_SHEET_DATA);
  private readonly sheet = inject(MatBottomSheetRef<HealthSourcesBottomSheetComponent, HealthSourcesResult>);
  private readonly haptics = inject(AppHapticsService);
  readonly manualProvider = HEALTH_PROVIDERS.QuantifiedSelf;
  readonly selectedProviders = signal(this.data.providers.filter(option => option.selected).map(option => option.provider));
  readonly allSelected = computed(() => this.selectedProviders().length === this.data.providers.length);
  readonly partlySelected = computed(() => this.selectedProviders().length > 0 && !this.allSelected());
  readonly providerOptions = computed(() => this.data.providers.map(option => ({
    ...option, selected: this.selectedProviders().includes(option.provider),
  })));
  readonly canApply = computed(() => !this.data.providers.length || this.selectedProviders().length > 0);

  selectAll(selected: boolean): void {
    const next = selected ? this.data.providers.map(option => option.provider) : [];
    if (next.length === this.selectedProviders().length) return;
    this.haptics.selection();
    this.selectedProviders.set(next);
  }

  selectProvider(provider: HealthProvider, selected: boolean): void {
    if (!this.data.providers.some(option => option.provider === provider)
      || this.selectedProviders().includes(provider) === selected) return;
    this.haptics.selection();
    this.selectedProviders.update(current => selected ? [...current, provider] : current.filter(value => value !== provider));
  }

  apply(): void {
    if (!this.canApply()) return;
    const changed = this.data.providers.some(option => option.selected !== this.selectedProviders().includes(option.provider));
    // The workspace owns accepted-change feedback after checking its lifecycle.
    this.sheet.dismiss({ providers: !changed ? null : this.allSelected() ? [] : [...this.selectedProviders()] });
  }

  cancel(): void {
    this.haptics.selection();
    this.sheet.dismiss();
  }
}
