import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal, computed, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataAscent, type User } from '@sports-alliance/sports-lib';
import { MAX_ACTIVITY_ASCENT_METERS, validActivityAscent } from '@shared/activity-ascent';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { ActivityAscentService, type ActivityAscentRow } from '../../services/activity-ascent.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppAuthService } from '../../authentication/app.auth.service';

@Component({
  selector: 'app-activity-ascent-editor', standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule],
  templateUrl: './activity-ascent-editor.component.html',
  styleUrls: ['./activity-ascent-editor.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityAscentEditorComponent implements OnInit {
  readonly data = inject<{ eventId: string; user: User }>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ActivityAscentEditorComponent>);
  private readonly service = inject(ActivityAscentService);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly rows = signal<ActivityAscentRow[]>([]);
  readonly selectedId = signal('');
  readonly selected = computed(() => this.rows().find(row => row.id === this.selectedId()));
  readonly value = signal<number | null>(null);
  readonly reset = signal(false);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly max = MAX_ACTIVITY_ASCENT_METERS;
  readonly unit = resolveUnitAwareDisplayFromValue(DataAscent.type, 1, this.data.user.settings?.unitSettings)?.unit ?? '';
  readonly sourceText = computed(() => {
    const row = this.selected();
    const source = row?.correction ? row.correction.sourceValue : row?.value;
    return typeof source === 'number'
      ? resolveUnitAwareDisplayFromValue(DataAscent.type, source, this.data.user.settings?.unitSettings)?.text ?? 'Unavailable' : 'Unavailable';
  });
  readonly canSave = computed(() => !!this.selected() && !this.loading() && !this.busy()
    && (this.reset() || (validActivityAscent(this.value()) && this.value() !== this.selected()?.value)));
  private generation = 0;

  constructor() {
    inject(AppAuthService).user$.pipe(takeUntilDestroyed()).subscribe(user => {
      if (user?.uid === this.data.user.uid) return;
      this.generation++; this.rows.set([]); this.value.set(null); this.ref.close();
    });
  }
  ngOnInit(): void { void this.load(); }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true); this.error.set('');
    try {
      const rows = await this.service.load(this.data.user.uid, this.data.eventId);
      if (this.destroyRef.destroyed || generation !== this.generation) return;
      this.rows.set(rows); this.selectedId.set(rows[0]?.id ?? ''); this.value.set(rows[0]?.value ?? null); this.reset.set(false);
    } catch (error) {
      if (!this.destroyRef.destroyed && generation === this.generation)
        this.error.set(error instanceof Error ? error.message : 'Could not load ascent.');
    } finally { if (generation === this.generation) this.loading.set(false); }
  }
  retry(): void { if (this.busy() || this.loading()) return; this.haptics.selection(); void this.load(); }
  select(id: string): void {
    const row = this.rows().find(item => item.id === id);
    if (!row || this.busy() || id === this.selectedId()) return;
    this.haptics.selection(); this.selectedId.set(id); this.value.set(row.value); this.reset.set(false); this.error.set('');
  }
  restore(): void {
    const row = this.selected();
    if (!row?.correction || this.busy() || this.reset()) return;
    this.haptics.selection(); this.reset.set(true); this.value.set(row.correction.sourceValue);
  }
  edit(value: number | null): void { this.value.set(value); this.reset.set(false); }
  close(): void { if (this.busy()) return; this.haptics.selection(); this.generation++; this.ref.close(); }
  async save(): Promise<void> {
    const row = this.selected();
    if (!row || !this.canSave()) return;
    this.haptics.selection(); this.busy.set(true); this.error.set(''); this.ref.disableClose = true;
    const generation = this.generation;
    try {
      const saved = await this.service.save(this.data.user.uid, this.data.eventId, row, this.reset() ? null : this.value());
      if (this.destroyRef.destroyed || generation !== this.generation) return;
      this.haptics.success(); this.ref.close(saved);
    } catch (error) {
      if (!this.destroyRef.destroyed && generation === this.generation) {
        this.error.set(error instanceof Error ? error.message : 'Could not save ascent. Reload the recording before retrying.');
        this.haptics.error();
      }
    } finally { this.busy.set(false); this.ref.disableClose = false; }
  }
}
