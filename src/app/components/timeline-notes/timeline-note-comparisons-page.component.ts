import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { TIMELINE_NOTE_LABELS, isTimelineNoteVisible, type TimelineNote } from '@shared/timeline-notes';
import { TIMELINE_NOTE_ICONS, timelineNoteColor } from '../../helpers/timeline-note-appearance.helper';
import { comparisonDateLabel } from '../../helpers/timeline-note-comparison.helper';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';

@Component({
  selector: 'app-timeline-note-comparisons-page', standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatListModule, MatProgressBarModule, AppChartSharedModule, PageHeaderComponent],
  templateUrl: './timeline-note-comparisons-page.component.html',
  styleUrl: './timeline-note-comparisons-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineNoteComparisonsPageComponent {
  private readonly notes = inject(AppTimelineNotesService);
  private readonly dialogs = inject(MatDialog);
  private readonly destroy = inject(DestroyRef);
  private readonly haptics = inject(AppHapticsService);
  private readonly savedNotes = signal<TimelineNote[]>([]);
  private readonly loadedOwner = signal<string | null>(null);
  private owner: string | null = null;
  private ownerVersion = 0;
  private version = 0;
  private cursors: Array<QueryDocumentSnapshot | null> = [null];
  private requestedPage = 0;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly managerError = signal<string | null>(null);
  readonly managerOpening = signal(false);
  readonly managerOpen = signal(false);
  readonly pageNumber = signal(0);
  readonly hasOlder = signal(false);
  readonly ownerAvailable = computed(() => {
    const uid = this.notes.uid();
    return !!uid && this.notes.isOwner(uid);
  });
  readonly rows = computed(() => {
    const uid = this.notes.uid();
    if (!uid || uid !== this.loadedOwner() || !this.notes.isOwner(uid)) return [];
    return this.savedNotes().map(note => ({ note, icon: TIMELINE_NOTE_ICONS[note.category], color: timelineNoteColor(note),
      category: TIMELINE_NOTE_LABELS[note.category], hidden: !isTimelineNoteVisible(note),
      dates: `${comparisonDateLabel(note.startDate)}${note.endDate === null ? ' · Ongoing'
        : note.endDate === note.startDate ? '' : ` – ${comparisonDateLabel(note.endDate)}`}` }));
  });

  constructor() {
    effect(() => {
      const uid = this.notes.uid();
      untracked(() => this.refresh(uid));
    });
    this.notes.changes$.pipe(takeUntilDestroyed()).subscribe(() => this.refresh(this.notes.uid()));
    this.destroy.onDestroy(() => { this.version++; });
  }

  retry(): void {
    if (!this.loading()) void this.loadPage(this.requestedPage);
  }
  newer(): void {
    if (!this.loading() && this.pageNumber() > 0) void this.loadPage(this.pageNumber() - 1);
  }
  older(): void {
    if (!this.loading() && this.hasOlder()) void this.loadPage(this.pageNumber() + 1);
  }
  async manageNotes(): Promise<void> {
    const uid = this.notes.uid();
    if (!uid || !this.notes.isOwner(uid) || this.managerOpening() || this.managerOpen()) return;
    const ownerVersion = this.ownerVersion;
    const current = () => !this.destroy.destroyed && ownerVersion === this.ownerVersion && this.notes.isOwner(uid);
    this.managerOpening.set(true); this.managerError.set(null); this.haptics.selection();
    try {
      const { TimelineNotesDialogComponent } = await import('./timeline-notes-dialog.component');
      if (!current()) return;
      if (this.dialogs.openDialogs.some(dialog => dialog.componentInstance instanceof TimelineNotesDialogComponent)) return;
      const ref = this.dialogs.open(TimelineNotesDialogComponent, {
        width: '560px', maxWidth: 'calc(100vw - 32px)', data: { uid },
      });
      this.managerOpen.set(true);
      ref.afterClosed().pipe(takeUntilDestroyed(this.destroy)).subscribe(() => {
        this.managerOpen.set(false);
        if (current()) this.refresh(uid);
      });
    } catch {
      if (current()) {
        this.managerError.set('Timeline notes could not open. Please try again.'); this.haptics.error();
      }
    } finally { this.managerOpening.set(false); }
  }
  private refresh(uid: string | null): void {
    if (uid !== this.owner) this.ownerVersion++;
    this.owner = uid; this.version++; this.cursors = [null]; this.requestedPage = 0;
    this.savedNotes.set([]); this.loadedOwner.set(null); this.pageNumber.set(0); this.hasOlder.set(false);
    this.error.set(null); this.managerError.set(null); this.loading.set(false);
    if (uid && this.notes.isOwner(uid)) void this.loadPage(0);
  }
  private async loadPage(index: number): Promise<void> {
    const uid = this.owner;
    if (!uid || !this.notes.isOwner(uid) || this.destroy.destroyed || index < 0 || index >= this.cursors.length) return;
    const version = ++this.version;
    const current = () => !this.destroy.destroyed && version === this.version && this.notes.isOwner(uid);
    this.requestedPage = index; this.loading.set(true); this.error.set(null); this.savedNotes.set([]);
    try {
      const page = await this.notes.list(uid, this.cursors[index]);
      if (!current()) return;
      this.savedNotes.set(page.notes); this.loadedOwner.set(uid); this.pageNumber.set(index);
      this.cursors[index + 1] = page.cursor; this.hasOlder.set(!!page.cursor);
    } catch { if (current()) this.error.set('Could not load notes for comparison. Please try again.'); }
    finally { if (current()) this.loading.set(false); }
  }
}
