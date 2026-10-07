import { AppAuthService } from '../../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DataRPE, type EventInterface, type User } from '@sports-alliance/sports-lib';
import { isBenchmarkEvent } from '@shared/event-classification';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { reflectionPrompts, type WorkoutReflection, type WorkoutReflectionTarget } from '@shared/workout-reflection';
import { SharedModule } from '../../modules/shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { WorkoutReflectionService, type ReflectionRecording } from '../../services/workout-reflection.service';

export interface WorkoutReflectionDialogData { event: EventInterface; user: User }
@Component({
  selector: 'app-workout-reflection-dialog', standalone: true, imports: [SharedModule],
  templateUrl: './workout-reflection-dialog.component.html', styleUrls: ['./workout-reflection-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkoutReflectionDialogComponent implements OnInit {
  readonly data = inject<WorkoutReflectionDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<WorkoutReflectionDialogComponent>);
  private readonly service = inject(WorkoutReflectionService);
  private readonly haptics = inject(AppHapticsService);
  private readonly browser = inject(BrowserCompatibilityService);
  private readonly destroyRef = inject(DestroyRef);
  readonly targets = [
    { id: 'recording', target: 'recording' as WorkoutReflectionTarget, activityId: 'recording', label: 'Whole recording', sport: '' },
    ...this.data.event.getActivities().flatMap((activity, index) => activity.getID?.()
      ? [{ id: `activity_${activity.getID()}`, target: 'activity' as WorkoutReflectionTarget,
          activityId: activity.getID(), label: `Activity ${index + 1} · ${activity.type}`, sport: activity.type }] : []),
  ];
  readonly selected = signal(this.targets[0]);
  readonly note = signal('');
  readonly saved = signal<WorkoutReflection | null>(null);
  readonly loading = signal(true);
  readonly readReady = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly deleteReview = signal(false);
  readonly exactlyLinked = signal(false);
  readonly workoutRpeDisplay = computed(() => {
    const stat = this.data.event.getStat?.(DataRPE.type);
    if (!stat) return null;
    const value = stat.getValue();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) return null;
    return resolveUnitAwareDisplayFromValue(DataRPE.type, value, this.data.user.settings?.unitSettings);
  });
  readonly prompts = computed(() => reflectionPrompts(this.selected().sport, this.exactlyLinked()));
  readonly hasContent = computed(() => !!this.note().trim());
  readonly changed = computed(() => this.hasContent()
    && ((this.note().trim() || null) !== (this.saved()?.note ?? null) || this.saved()?.deleted === true));
  private generation = 0;
  private attempt: { signature: string; id: string } | null = null;
  constructor() {
    inject(AppAuthService).user$.pipe(takeUntilDestroyed()).subscribe(user => {
      if (user?.uid === this.data.user.uid) return;
      this.generation++; this.note.set(''); this.saved.set(null);
      this.ref.close();
    });
  }
  ngOnInit(): void { void this.load(); }
  private recording(): ReflectionRecording {
    return { uid: this.data.user.uid, eventId: this.data.event.getID(), ...this.selected() };
  }
  async select(id: string): Promise<void> {
    const target = this.targets.find(value => value.id === id);
    if (!target || this.busy() || target.id === this.selected().id) return;
    this.haptics.selection();
    this.selected.set(target);
    await this.load();
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true); this.readReady.set(false); this.error.set(''); this.note.set('');
    this.saved.set(null); this.exactlyLinked.set(false); this.deleteReview.set(false); this.attempt = null;
    const current = () => !this.destroyRef.destroyed && generation === this.generation;
    try {
      if (isBenchmarkEvent(this.data.event as unknown as Record<string, unknown>)) throw new Error('Benchmark recordings cannot have a reflection.');
      const recording = this.recording();
      const value = await this.service.read(recording);
      if (!current()) return;
      this.readReady.set(true); this.saved.set(value); this.note.set(value?.note ?? '');
      void this.service.hasExactWorkoutLink(recording).then(linked => {
        if (current()) this.exactlyLinked.set(linked);
      }).catch(() => { /* Unknown link context keeps the generic optional prompt. */ });
    } catch (error) {
      if (current()) this.error.set(error instanceof Error ? error.message : 'Could not load reflection.');
    } finally { if (current()) this.loading.set(false); }
  }
  reload(): void { if (this.busy()) return; this.haptics.selection(); void this.load(); }
  cancel(): void {
    if (this.busy()) return;
    this.haptics.selection(); this.generation++; this.ref.close();
  }
  reviewDelete(): void {
    if (this.busy() || !this.saved() || this.saved()?.deleted) return;
    this.deleteReview.set(true); this.haptics.selection();
  }
  cancelDelete(): void { if (this.busy() || !this.deleteReview()) return; this.deleteReview.set(false); this.haptics.selection(); }
  async apply(deleted = false): Promise<void> {
    if (this.busy() || this.loading() || !this.readReady() || (deleted ? !this.deleteReview() : !this.changed())) return;
    this.haptics.selection();
    const fields = { note: this.note().trim() || null };
    const revision = this.saved()?.revision ?? 0;
    const signature = JSON.stringify([this.selected().id, revision, deleted, fields]);
    if (signature !== this.attempt?.signature) {
      const id = this.browser.createRandomUUID();
      if (!id) {
        this.error.set('Saving is unavailable in this browser. Open the recording in a supported browser.');
        this.haptics.error();
        return;
      }
      this.attempt = { signature, id };
    }
    const generation = this.generation;
    const current = () => !this.destroyRef.destroyed && generation === this.generation;
    this.busy.set(true); this.error.set(''); this.ref.disableClose = true;
    try {
      await this.service.save(this.recording(), revision, this.attempt.id, fields, deleted);
      if (!current()) return;
      this.haptics.success(); this.ref.close(true);
    } catch (error) {
      if (current()) {
        this.error.set(error instanceof Error ? error.message : 'Could not save reflection.');
        this.haptics.error();
      }
    } finally { this.busy.set(false); this.ref.disableClose = false; }
  }
}
