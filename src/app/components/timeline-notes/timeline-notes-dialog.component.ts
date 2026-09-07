import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { TIMELINE_NOTE_CATEGORIES, TIMELINE_NOTE_LABELS, TIMELINE_NOTE_LIMITS, timelineToday, timelineNoteDates,
  validateTimelineFields, type TimelineNote } from '@shared/timeline-notes';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';

export interface TimelineNotesDialogData { uid: string; notes?: readonly TimelineNote[] }

@Component({
  selector: 'app-timeline-notes-dialog', standalone: true,
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: 'dynamic' } }],
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatProgressSpinnerModule],
  templateUrl: './timeline-notes-dialog.component.html', styleUrls: ['./timeline-notes-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineNotesDialogComponent {
  readonly data = inject<TimelineNotesDialogData>(MAT_DIALOG_DATA);
  readonly service = inject(AppTimelineNotesService);
  private readonly ref = inject(MatDialogRef<TimelineNotesDialogComponent>);
  private readonly dialogs = inject(MatDialog);
  private readonly compatibility = inject(BrowserCompatibilityService);
  private readonly builder = inject(FormBuilder);
  readonly view = signal<'list' | 'edit'>('list');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly existing = signal<TimelineNote | null>(null);
  readonly notes = signal<readonly TimelineNote[]>([]);
  readonly rows = computed(() => this.notes().map(note => ({ note, dates: timelineNoteDates(note), category: TIMELINE_NOTE_LABELS[note.category] })));
  readonly mode = signal<'single' | 'range' | 'ongoing'>('single');
  readonly options = TIMELINE_NOTE_CATEGORIES.map(id => ({ id, label: TIMELINE_NOTE_LABELS[id] }));
  readonly limits = TIMELINE_NOTE_LIMITS;
  readonly nextCursor = signal<QueryDocumentSnapshot | null>(null);
  readonly pageNumber = signal(0);
  private cursors: Array<QueryDocumentSnapshot | null> = [null];
  private mutationId: string | null = null;
  private zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  private loadVersion = 0;
  readonly form = this.builder.nonNullable.group({ category: ['other', Validators.required], title: ['Other', [Validators.required, Validators.maxLength(TIMELINE_NOTE_LIMITS.title)]],
    details: ['', Validators.maxLength(TIMELINE_NOTE_LIMITS.details)], startDate: [timelineToday(this.zone), Validators.required], endDate: [timelineToday(this.zone)] });
  readonly title = computed(() => this.view() === 'list' ? 'Timeline notes' : this.existing() ? 'Edit note' : 'Add note');

  constructor() {
    effect(() => { if (this.service.uid() !== this.data.uid) this.ref.close(); });
    effect(() => {
      this.ref.disableClose = this.busy();
      if (this.busy()) this.form.disable({ emitEvent: false }); else this.form.enable({ emitEvent: false });
    });
    if (this.data.notes?.length === 1) this.edit(this.data.notes[0]);
    else if (this.data.notes?.length) this.notes.set(this.data.notes);
    else void this.loadPage(0);
  }
  async loadPage(index: number): Promise<void> {
    if (this.busy()) return;
    const version = ++this.loadVersion;
    this.busy.set(true); this.error.set(null);
    try {
      const page = await this.service.list(this.data.uid, this.cursors[index]);
      if (version !== this.loadVersion) return;
      this.notes.set(page.notes); this.nextCursor.set(page.cursor); this.pageNumber.set(index);
      this.cursors[index + 1] = page.cursor;
    } catch { this.error.set('Could not load notes. Please try again.'); }
    finally { if (version === this.loadVersion) this.busy.set(false); }
  }
  edit(note: TimelineNote | null): void {
    if (this.busy()) return;
    this.error.set(null); this.conflict.set(false); this.existing.set(note);
    this.zone = note?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const today = timelineToday(this.zone);
    this.mutationId = note ? null : this.compatibility.createRandomUUID();
    this.form.reset({ category: note?.category ?? 'other', title: note?.title ?? 'Other', details: note?.details ?? '',
      startDate: note?.startDate ?? today, endDate: note?.endDate ?? today });
    this.mode.set(note?.endDate === null ? 'ongoing' : note && note.endDate !== note.startDate ? 'range' : 'single');
    this.view.set('edit');
  }
  categoryChanged(category: string): void {
    const current = this.form.controls.title.value;
    if (!current || Object.values(TIMELINE_NOTE_LABELS).includes(current)) {
      this.form.controls.title.setValue(this.options.find(option => option.id === category)?.label ?? 'Other');
    }
  }
  async showList(): Promise<void> {
    if (this.busy()) return;
    this.view.set('list'); this.error.set(null); this.conflict.set(false);
    this.cursors = [null]; await this.loadPage(0);
  }
  async save(): Promise<void> {
    if (this.busy() || this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.error.set(null); this.conflict.set(false);
    try {
      const value = this.form.getRawValue();
      const fields = validateTimelineFields({ ...value, timeZone: this.zone,
        endDate: this.mode() === 'single' ? value.startDate : this.mode() === 'ongoing' ? null : value.endDate });
      this.busy.set(true);
      const note = this.existing();
      await this.service.save(this.data.uid, note ? { ...fields, mode: 'update', noteId: note.id, expectedRevision: note.revision }
        : { ...fields, mode: 'create', clientMutationId: this.mutationId! });
      this.busy.set(false);
      await this.showList();
    } catch (error) { this.showMutationError(error); }
    finally { this.busy.set(false); }
  }
  async endToday(): Promise<void> {
    if (this.busy()) return;
    this.form.controls.endDate.setValue(timelineToday(this.zone)); this.mode.set('range');
    await this.save();
  }
  async remove(): Promise<void> {
    const note = this.existing();
    if (!note || this.busy()) return;
    const confirmed = await firstValueFrom(this.dialogs.open(ConfirmationDialogComponent, { data: {
      title: 'Delete note?', message: 'This removes the note from your timeline and charts.', confirmText: 'Delete', confirmColor: 'warn',
    } }).afterClosed());
    if (!confirmed || !this.service.isOwner(this.data.uid)) return;
    this.busy.set(true); this.error.set(null);
    try { await this.service.remove(this.data.uid, { noteId: note.id, expectedRevision: note.revision }); this.busy.set(false); await this.showList(); }
    catch (error) { this.showMutationError(error); }
    finally { this.busy.set(false); }
  }
  async reloadNote(): Promise<void> {
    const note = this.existing();
    if (!note || this.busy()) return;
    this.busy.set(true);
    try {
      const fresh = await this.service.get(this.data.uid, note.id);
      this.busy.set(false);
      if (fresh) this.edit(fresh); else { this.error.set('This note no longer exists. Your unsaved text is still here.'); this.conflict.set(false); }
    } catch { this.error.set('Could not reload the note. Your unsaved text is still here.'); }
    finally { this.busy.set(false); }
  }
  async toggleVisibility(value: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try { await this.service.setShowOnCharts(this.data.uid, value); }
    catch { this.error.set('Could not save chart visibility. Please try again.'); }
    finally { this.busy.set(false); }
  }
  private showMutationError(error: unknown): void {
    const code = (error as { code?: string })?.code;
    this.conflict.set(code === 'functions/aborted');
    this.error.set(code === 'functions/aborted' ? this.existing()
      ? 'This note changed elsewhere. Your unsaved text is preserved. Reload before editing again.'
      : 'This create request may already have succeeded. Your draft is preserved. Browse your notes before creating another.'
      : code === 'functions/not-found' ? 'This note was deleted. Your unsaved text is preserved.'
        : code === 'functions/failed-precondition' || code === 'functions/unauthenticated' ? 'Your secure session or account changed. Reopen Timeline notes and try again.'
          : error instanceof Error && error.name === 'TimelineNoteValidationError' ? error.message : 'Could not save your change. Your text is preserved; please try again.');
  }
}
