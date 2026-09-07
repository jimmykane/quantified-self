import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import type { HealthProvider } from '@shared/health';
import type { HealthWorkspaceRange } from '../../helpers/health-workspace.helper';
import { SharedModule } from '../../modules/shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';

export interface HealthViewOptionsData {
  range: HealthWorkspaceRange;
  ranges: readonly { range: HealthWorkspaceRange; label: string; buttonLabel: string }[];
  providers: readonly { provider: HealthProvider; label: string; selected: boolean }[];
  sourcesLoading: boolean;
}

export interface HealthViewOptionsResult {
  range: HealthWorkspaceRange;
  /** null leaves source selection untouched when sources were still loading. */
  providers: HealthProvider[] | null;
}

@Component({
  selector: 'app-health-view-options-bottom-sheet',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './health-view-options-bottom-sheet.component.html',
  styleUrls: ['./health-view-options-bottom-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthViewOptionsBottomSheetComponent {
  readonly data = inject<HealthViewOptionsData>(MAT_BOTTOM_SHEET_DATA);
  private readonly sheet = inject(MatBottomSheetRef<HealthViewOptionsBottomSheetComponent, HealthViewOptionsResult>);
  private readonly haptics = inject(AppHapticsService);
  readonly range = signal(this.data.range);
  readonly selectedProviders = signal(this.data.providers.filter(option => option.selected).map(option => option.provider));
  readonly allSelected = computed(() => this.selectedProviders().length === this.data.providers.length);
  readonly partlySelected = computed(() => this.selectedProviders().length > 0 && !this.allSelected());
  readonly providerOptions = computed(() => this.data.providers.map(option => ({
    ...option, selected: this.selectedProviders().includes(option.provider),
  })));
  readonly canApply = computed(() => this.data.sourcesLoading || !this.data.providers.length || this.selectedProviders().length > 0);

  selectRange(range: HealthWorkspaceRange): void {
    if (range === this.range() || !this.data.ranges.some(option => option.range === range)) return;
    this.haptics.selection();
    this.range.set(range);
  }

  selectAll(selected: boolean): void {
    if (this.data.sourcesLoading || !this.data.providers.length) return;
    const next = selected ? this.data.providers.map(option => option.provider) : [];
    if (next.length === this.selectedProviders().length) return;
    this.haptics.selection();
    this.selectedProviders.set(next);
  }

  selectProvider(provider: HealthProvider, selected: boolean): void {
    if (this.data.sourcesLoading || !this.data.providers.some(option => option.provider === provider)
      || this.selectedProviders().includes(provider) === selected) return;
    this.haptics.selection();
    this.selectedProviders.update(current => selected ? [...current, provider] : current.filter(value => value !== provider));
  }

  apply(): void {
    if (!this.canApply()) return;
    // The workspace owns feedback for the accepted change, after its lifecycle check.
    this.sheet.dismiss({
      range: this.range(),
      providers: this.data.sourcesLoading ? null : this.allSelected() ? [] : [...this.selectedProviders()],
    });
  }

  cancel(): void {
    this.haptics.selection();
    this.sheet.dismiss();
  }
}
