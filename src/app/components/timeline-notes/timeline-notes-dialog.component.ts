import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule, type MatCheckbox } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import type { Dayjs } from 'dayjs';
import { firstValueFrom } from 'rxjs';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { TIMELINE_NOTE_CATEGORIES, TIMELINE_NOTE_COLORS, TIMELINE_NOTE_LABELS, TIMELINE_NOTE_LIMITS, timelineToday, timelineNoteDates,
  validateTimelineFields, isTimelineNoteVisible, type TimelineNote } from '@shared/timeline-notes';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { MAT_DAYJS_DATE_FORMATS } from '../../shared/adapters/mat-dayjs-date.module';
import { TimelineNoteDateAdapter, timelineNoteDateInput, timelineNoteDateLabel } from './timeline-note-date-adapter';
import { TIMELINE_NOTE_ICONS, TIMELINE_NOTE_COLOR_LABELS, timelineNoteColor } from '../../helpers/timeline-note-appearance.helper';

export interface TimelineNotesDialogData { uid: string; notes?: readonly TimelineNote[] }

@Component({
  selector: 'app-timeline-notes-dialog', standalone: true,
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: 'dynamic' } },
    { provide: DateAdapter, useClass: TimelineNoteDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: MAT_DAYJS_DATE_FORMATS }],
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatProgressSpinnerModule, MatDatepickerModule, AppChartSharedModule],
  templateUrl: './timeline-notes-dialog.component.html', styleUrls: ['./timeline-notes-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineNotesDialogComponent {
  protected readonly haptics = inject(AppHapticsService);
  readonly data = inject<TimelineNotesDialogData>(MAT_DIALOG_DATA);
  readonly service = inject(AppTimelineNotesService);
  private readonly ref = inject(MatDialogRef<TimelineNotesDialogComponent>);
  private readonly dialogs = inject(MatDialog);
  private readonly compatibility = inject(BrowserCompatibilityService);
  private readonly builder = inject(FormBuilder);
  private readonly dateAdapter = inject(DateAdapter) as TimelineNoteDateAdapter;
  readonly view = signal<'list' | 'edit'>('list');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly existing = signal<TimelineNote | null>(null);
  readonly notes = signal<readonly TimelineNote[]>([]);
  readonly rows = computed(() => this.notes().map(note => ({ note, dates: timelineNoteDates(note), category: TIMELINE_NOTE_LABELS[note.category],
    icon: TIMELINE_NOTE_ICONS[note.category], color: timelineNoteColor(note), hidden: !isTimelineNoteVisible(note) })));
  readonly mode = signal<'single' | 'range' | 'ongoing'>('single');
  readonly options = TIMELINE_NOTE_CATEGORIES.map(id => ({ id, label: TIMELINE_NOTE_LABELS[id], icon: TIMELINE_NOTE_ICONS[id] }));
  readonly colorOptions = TIMELINE_NOTE_COLORS.map(id => ({ id, label: TIMELINE_NOTE_COLOR_LABELS[id], color: timelineNoteColor({ color: id }) }));
  readonly limits = TIMELINE_NOTE_LIMITS;
  readonly nextCursor = signal<QueryDocumentSnapshot | null>(null);
  readonly pageNumber = signal(0);
  readonly requestedPage = signal(0);
  private cursors: Array<QueryDocumentSnapshot | null> = [null];
  private mutationId: string | null = null;
  private zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  private loadVersion = 0;
  private committedDates = { startDate: '', endDate: '' };
  readonly form = this.builder.nonNullable.group({ category: ['other', Validators.required], title: ['Other', [Validators.required, Validators.maxLength(TIMELINE_NOTE_LIMITS.title)]],
    details: ['', Validators.maxLength(TIMELINE_NOTE_LIMITS.details)],
    startDate: this.builder.control<Dayjs | null>(timelineNoteDateInput(timelineToday(this.zone)), Validators.required),
    endDate: this.builder.control<Dayjs | null>(timelineNoteDateInput(timelineToday(this.zone))), showOnCharts: [true], color: ['default'] });
  readonly title = computed(() => this.view() === 'list' ? 'Timeline notes' : this.existing() ? 'Edit note' : 'Add note');
  get selectedCategory() { return this.options.find(option => option.id === this.form.controls.category.value)!; }
  get selectedColor() { return this.colorOptions.find(option => option.id === this.form.controls.color.value)!; }
  get today(): Dayjs { return this.dateAdapter.today(); }

  constructor() {
    effect(() => { if (this.service.uid() !== this.data.uid) this.ref.close(); });
    effect(() => {
      this.ref.disableClose = this.busy();
      if (this.busy()) this.form.disable({ emitEvent: false });
      else {
        this.form.enable({ emitEvent: false });
        // Keep an unfinished range draft, but do not let a hidden end field block a single/ongoing note.
        if (this.mode() !== 'range') this.form.controls.endDate.disable({ emitEvent: false });
      }
    });
    if (this.data.notes?.length === 1) this.edit(this.data.notes[0]);
    else if (this.data.notes?.length) this.notes.set(this.data.notes);
    else void this.loadPage(0);
  }
  async loadPage(index: number): Promise<void> {
    if (this.busy()) return;
    const version = ++this.loadVersion;
    this.requestedPage.set(index);
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
    this.dateAdapter.timeZone = this.zone;
    const today = timelineToday(this.zone);
    this.mutationId = note ? null : this.compatibility.createRandomUUID();
    this.form.reset({ category: note?.category ?? 'other', title: note?.title ?? 'Other', details: note?.details ?? '',
      startDate: timelineNoteDateInput(note?.startDate ?? today), endDate: timelineNoteDateInput(note?.endDate ?? today),
      showOnCharts: note ? isTimelineNoteVisible(note) : true, color: note?.color ?? 'default' });
    this.committedDates = { startDate: note?.startDate ?? today, endDate: note?.endDate ?? today };
    this.mode.set(note?.endDate === null ? 'ongoing' : note && note.endDate !== note.startDate ? 'range' : 'single');
    this.view.set('edit');
  }
  categoryChanged(category: string): void {
    const current = this.form.controls.title.value;
    if (!current || Object.values(TIMELINE_NOTE_LABELS).includes(current)) {
      this.form.controls.title.setValue(this.options.find(option => option.id === category)?.label ?? 'Other');
    }
  }
  dateChanged(field: 'startDate' | 'endDate', value: Dayjs | null): void {
    const label = timelineNoteDateLabel(value);
    if (this.busy() || !label || this.form.controls[field].invalid || label === this.committedDates[field]) return;
    this.committedDates[field] = label;
    this.haptics.selection();
  }
  async showList(): Promise<void> {
    if (this.busy()) return;
    this.view.set('list'); this.error.set(null); this.conflict.set(false);
    this.cursors = [null]; await this.loadPage(0);
  }
  async save(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); this.haptics.error(); return; }
    this.error.set(null); this.conflict.set(false);
    try {
      const value = this.form.getRawValue();
      const startDate = timelineNoteDateLabel(value.startDate);
      const fields = validateTimelineFields({ ...value, startDate, timeZone: this.zone,
        endDate: this.mode() === 'single' ? startDate : this.mode() === 'ongoing' ? null : timelineNoteDateLabel(value.endDate) });
      this.haptics.selection();
      this.busy.set(true);
      const note = this.existing();
      await this.service.save(this.data.uid, note ? { ...fields, mode: 'update', noteId: note.id, expectedRevision: note.revision }
        : { ...fields, mode: 'create', clientMutationId: this.mutationId! });
      if (this.service.isOwner(this.data.uid)) this.haptics.success();
      this.busy.set(false);
      await this.showList();
    } catch (error) { this.showMutationError(error); }
    finally { this.busy.set(false); }
  }
  async endToday(): Promise<void> {
    if (this.busy()) return;
    this.form.controls.endDate.setValue(this.today); this.mode.set('range');
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
    try {
      await this.service.remove(this.data.uid, { noteId: note.id, expectedRevision: note.revision });
      if (this.service.isOwner(this.data.uid)) this.haptics.success();
      this.busy.set(false); await this.showList();
    }
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
  async toggleVisibility(value: boolean, checkbox: MatCheckbox): Promise<void> {
    if (this.busy()) return;
    this.haptics.selection();
    this.busy.set(true); this.error.set(null);
    try { await this.service.setShowOnCharts(this.data.uid, value); }
    catch {
      if (this.service.isOwner(this.data.uid)) this.haptics.error();
      this.error.set('Could not save chart visibility. Please try again.');
    }
    finally {
      // Material changes its own checked state before emitting. Restore the persisted value on failure.
      checkbox.checked = this.service.showOnCharts();
      this.busy.set(false);
    }
  }
  private showMutationError(error: unknown): void {
    if (this.service.isOwner(this.data.uid)) this.haptics.error();
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
