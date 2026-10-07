import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataFeeling, DataRPE, type EventInterface, type User } from '@sports-alliance/sports-lib';
import { isBenchmarkEvent } from '@shared/event-classification';
import { reflectionPrompts, type WorkoutReflection, type WorkoutReflectionTarget } from '@shared/workout-reflection';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { eventDetailsChanges, eventDetailsValues, feedbackOptions } from '../../../helpers/event-details-form.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { WorkoutReflectionService, type ReflectionChange, type ReflectionRecording } from '../../../services/workout-reflection.service';

@Component({
  selector: 'app-event-details-summary-bottom-sheet', standalone: false,
  templateUrl: './event-details-summary-bottom-sheet.component.html',
  styleUrls: ['./event-details-summary-bottom-sheet.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailsSummaryBottomSheetComponent implements OnInit {
  readonly data = inject<{ event: EventInterface; user: User }>(MAT_BOTTOM_SHEET_DATA);
  private readonly ref = inject(MatBottomSheetRef<EventDetailsSummaryBottomSheetComponent>);
  private readonly service = inject(WorkoutReflectionService);
  private readonly haptics = inject(AppHapticsService);
  private readonly browser = inject(BrowserCompatibilityService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  readonly original = eventDetailsValues(this.data.event);
  readonly name = signal(this.original.name);
  readonly description = signal(this.original.description);
  readonly feeling = signal(this.original.feeling);
  readonly rpe = signal(this.original.rpe);
  readonly feelings = feedbackOptions('feeling', this.original.feeling, this.data.user.settings?.unitSettings);
  readonly rpeOptions = feedbackOptions('rpe', this.original.rpe, this.data.user.settings?.unitSettings);
  readonly canReflect = !isBenchmarkEvent(this.data.event as unknown as Record<string, unknown>);
  readonly targets = [
    { id: 'recording', target: 'recording' as WorkoutReflectionTarget, activityId: 'recording', label: 'Whole recording', sport: '' },
    ...this.data.event.getActivities().flatMap((activity, index) => activity.getID?.()
      ? [{ id: `activity_${activity.getID()}`, target: 'activity' as WorkoutReflectionTarget,
          activityId: activity.getID(), label: `Activity ${index + 1} · ${activity.type}`, sport: activity.type }] : []),
  ];
  readonly selected = signal(this.targets[0]);
  readonly note = signal('');
  readonly saved = signal<WorkoutReflection | null>(null);
  readonly loading = signal(this.canReflect);
  readonly readReady = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly reflectionError = signal('');
  readonly deleteReview = signal(false);
  readonly exactlyLinked = signal(false);
  readonly prompts = computed(() => reflectionPrompts(this.selected().sport, this.exactlyLinked()));
  readonly detailsChanges = computed(() => eventDetailsChanges(this.original,
    { name: this.name(), description: this.description(), feeling: this.feeling(), rpe: this.rpe() }));
  readonly reflectionChanged = computed(() => this.canReflect && (this.deleteReview()
    || (!!this.note().trim() && (this.note().trim() !== (this.saved()?.note ?? '') || this.saved()?.deleted === true))));
  readonly emptyExistingNote = computed(() => this.saved() && !this.saved()?.deleted && !this.note().trim() && !this.deleteReview());
  readonly hasChanges = computed(() => Object.keys(this.detailsChanges()).length > 0 || this.reflectionChanged());
  readonly canSave = computed(() => !this.busy() && this.hasChanges() && !this.emptyExistingNote()
    && (!this.reflectionChanged() || this.readReady()));
  private generation = 0;
  private attempt: { signature: string; id: string } | null = null;

  constructor() {
    inject(AppAuthService).user$.pipe(takeUntilDestroyed()).subscribe(user => {
      if (user?.uid === this.data.user.uid) return;
      this.generation++; this.note.set(''); this.saved.set(null); this.name.set(''); this.description.set('');
      this.rpe.set(null); this.feeling.set(null); this.error.set(''); this.reflectionError.set('');
      this.ref.dismiss();
    });
  }
  ngOnInit(): void { if (this.canReflect) void this.load(); }
  private recording(): ReflectionRecording {
    return { uid: this.data.user.uid, eventId: this.data.event.getID(), ...this.selected() };
  }
  setRating(kind: 'feeling' | 'rpe', value: number): void {
    const state = kind === 'rpe' ? this.rpe : this.feeling;
    if (this.busy() || value === state()) return;
    state.set(value); this.haptics.selection();
  }
  async select(id: string): Promise<void> {
    const target = this.targets.find(value => value.id === id);
    if (!target || this.busy() || target.id === this.selected().id) return;
    this.haptics.selection(); this.selected.set(target); await this.load();
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true); this.readReady.set(false); this.reflectionError.set(''); this.note.set('');
    this.saved.set(null); this.exactlyLinked.set(false); this.deleteReview.set(false); this.attempt = null;
    const current = () => !this.destroyRef.destroyed && generation === this.generation;
    try {
      const recording = this.recording();
      const value = await this.service.read(recording);
      if (!current()) return;
      this.readReady.set(true); this.saved.set(value); this.note.set(value?.note ?? '');
      void this.service.hasExactWorkoutLink(recording).then(linked => {
        if (current()) this.exactlyLinked.set(linked);
      }).catch(() => { /* Keep the generic optional prompt when the link is unknown. */ });
    } catch (error) {
      if (current()) this.reflectionError.set(error instanceof Error ? error.message : 'Could not load reflection.');
    } finally { if (current()) this.loading.set(false); }
  }
  reload(): void { if (this.busy()) return; this.haptics.selection(); void this.load(); }
  close(): void { if (this.busy()) return; this.haptics.selection(); this.generation++; this.ref.dismiss(); }
  reviewDelete(): void {
    if (this.busy() || !this.saved() || this.saved()?.deleted || this.deleteReview()) return;
    this.deleteReview.set(true); this.haptics.selection();
  }
  cancelDelete(): void { if (this.busy() || !this.deleteReview()) return; this.deleteReview.set(false); this.haptics.selection(); }

  async save(): Promise<void> {
    if (!this.canSave()) return;
    this.haptics.selection();
    const changes = this.detailsChanges();
    let reflection: ReflectionChange | undefined;
    if (this.reflectionChanged()) {
      const fields = { note: this.note().trim() || null };
      const expectedRevision = this.saved()?.revision ?? 0;
      const signature = JSON.stringify([this.selected().id, expectedRevision, this.deleteReview(), fields, changes]);
      if (signature !== this.attempt?.signature) {
        const id = this.browser.createRandomUUID();
        if (!id) { this.error.set('Saving is unavailable in this browser. Open the recording in a supported browser.'); this.haptics.error(); return; }
        this.attempt = { signature, id };
      }
      reflection = { expectedRevision, mutationId: this.attempt.id, fields, deleted: this.deleteReview() };
    }
    const generation = this.generation;
    const current = () => !this.destroyRef.destroyed && generation === this.generation;
    this.busy.set(true); this.error.set(''); this.ref.disableClose = true;
    try {
      await this.service.saveEventDetails(this.recording(), changes, reflection);
      if (!current()) return;
      if (changes.name) this.data.event.name = changes.name.after;
      if (changes.description) this.data.event.description = changes.description.after;
      if (changes.feeling) this.data.event.addStat(new DataFeeling(changes.feeling.after));
      if (changes.rpe) this.data.event.addStat(new DataRPE(changes.rpe.after));
      this.haptics.success(); this.snackBar.open('Event details saved', undefined, { duration: 2000 }); this.ref.dismiss(true);
    } catch (error) {
      if (current()) { this.error.set(error instanceof Error ? error.message : 'Could not save event details.'); this.haptics.error(); }
    } finally { this.busy.set(false); this.ref.disableClose = false; }
  }
}
