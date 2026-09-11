import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { isTimelineNoteVisible, type TimelineNote, type TimelineNoteRange, type TimelineNotesLoad } from '@shared/timeline-notes';
import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TimelineNotesDialogComponent } from './timeline-notes-dialog.component';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';

/** Workspace-owned loading; shared charts only receive an explicit private-data input. */
@Component({
  selector: 'app-timeline-notes-workspace', standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, AppChartSharedModule],
  template: `
    <div class="timeline-notes-action" [attr.aria-busy]="loading()">
      <button mat-button type="button" class="timeline-notes-button" appHapticTap (click)="open()"
        [disabled]="!activeOwner()" aria-label="Timeline notes" matTooltip="Timeline notes">
        <mat-icon aria-hidden="true">event_note</mat-icon><span>Timeline notes</span>
      </button>
      <mat-progress-bar class="timeline-notes-progress" [class.timeline-notes-progress-visible]="loading()"
        mode="indeterminate" aria-hidden="true" />
    </div>
    <span class="cdk-visually-hidden" role="status">{{ loading() ? 'Loading notes…' : '' }}</span>
    @if (error()) {
      <button mat-button type="button" appHapticTap (click)="refresh()" matTooltip="Notes could not load. The rest of this view is still available.">Retry notes</button>
    }
    @if (incomplete()) {
      <button mat-button type="button" appHapticTap (click)="open()" matTooltip="Some notes are not shown because this view reached its note or data limit. Browse all notes here.">Some notes not shown</button>
    }
  `,
  styleUrls: ['./timeline-notes-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineNotesWorkspaceComponent {
  /** Shared/profile surfaces must explicitly match their displayed owner to the signed-in account. */
  readonly ownerUid = input<string | null | undefined>(undefined);
  /** Non-chart workspaces can register an explicit visible calendar range. */
  readonly visibleRange = input<TimelineNoteRange | null>(null);
  readonly service = inject(AppTimelineNotesService);
  readonly activeOwner = computed(() => {
    const uid = this.service.uid();
    return this.ownerUid() === undefined || this.ownerUid() === uid ? uid : null;
  });
  private readonly dialogs = inject(MatDialog);
  private readonly haptics = inject(AppHapticsService);
  private readonly zone = inject(NgZone);
  private readonly destroy = inject(DestroyRef);
  private readonly notes = signal<readonly TimelineNote[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly incomplete = signal<TimelineNotesLoad['incomplete']>(null);
  private readonly ranges = new Map<object, TimelineNoteRange>();
  private version = 0;
  private queued = false;
  private destroyed = false;
  private rangeKey = '';
  private readonly loadedOwner = signal<string | null>(null);
  private readonly reportRange = (key: object, range: TimelineNoteRange | null) => {
    if (range) this.ranges.set(key, range); else this.ranges.delete(key);
    this.schedule();
  };
  readonly context = computed<TimelineNoteChartContext>(() => {
    const owner = this.activeOwner();
    return {
      ownerUid: owner,
      notes: this.service.showOnCharts() && owner === this.loadedOwner() ? this.notes().filter(isTimelineNoteVisible) : [],
      // ECharts callbacks run outside Angular; entering here lets Material own dialog/focus lifecycle.
      select: notes => this.zone.run(() => {
        if (this.destroyed || !notes.length || !owner || owner !== this.activeOwner() || !this.service.isOwner(owner) || !this.service.showOnCharts() || owner !== this.loadedOwner()) return;
        // A queued marker click must not reopen a note that was hidden or removed since it rendered.
        const ids = new Set(notes.map(note => note.id));
        const selected = this.notes().filter(note => ids.has(note.id) && isTimelineNoteVisible(note));
        if (!selected.length) return;
        // Note markers are not metric-series clicks; this accepted action owns their feedback.
        this.haptics.selection();
        this.open(selected);
      }),
      reportRange: this.reportRange,
    };
  });

  constructor() {
    // A new route instance means returning to the workspace, not reusing an old cache forever.
    this.service.invalidate();
    effect(() => this.reportRange(this, this.visibleRange()));
    effect(() => {
      this.activeOwner(); this.service.showOnCharts();
      untracked(() => { this.rangeKey = ''; this.schedule(); });
    });
    this.service.changes$.pipe(takeUntilDestroyed()).subscribe(() => { this.rangeKey = ''; this.schedule(); });
    const returned = () => { if (document.visibilityState === 'visible') this.refresh(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', returned);
      document.addEventListener('visibilitychange', returned);
      this.destroy.onDestroy(() => { window.removeEventListener('focus', returned); document.removeEventListener('visibilitychange', returned); });
    }
    this.destroy.onDestroy(() => { this.destroyed = true; this.version++; this.ranges.clear(); });
  }
  open(notes?: readonly TimelineNote[]): void {
    const uid = this.activeOwner();
    if (this.destroyed || !uid || !this.service.isOwner(uid)) return;
    this.dialogs.open(TimelineNotesDialogComponent, { width: '560px', maxWidth: 'calc(100vw - 32px)', data: { uid, notes } });
  }
  refresh(): void { this.service.invalidate(); }
  private schedule(): void {
    if (this.queued || this.destroyed) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (!this.destroyed) void this.load(); });
  }
  private async load(): Promise<void> {
    const uid = this.activeOwner();
    const ranges = [...this.ranges.values()];
    const range = ranges.length ? {
      startDate: ranges.map(value => value.startDate).sort()[0],
      endDate: ranges.map(value => value.endDate).sort().at(-1)!,
    } : null;
    const key = JSON.stringify([uid, this.service.showOnCharts(), range]);
    if (key === this.rangeKey) return;
    this.rangeKey = key;
    const version = ++this.version;
    this.notes.set([]); this.loadedOwner.set(uid);
    this.error.set(false); this.incomplete.set(null); this.loading.set(false);
    if (!uid || !range || !this.service.showOnCharts()) return;
    this.loading.set(true);
    try {
      const result = await this.service.loadRange(uid, range);
      if (version !== this.version || uid !== this.activeOwner() || !this.service.isOwner(uid)) return;
      this.notes.set(result.notes); this.incomplete.set(result.incomplete);
    } catch {
      if (version === this.version && this.service.isOwner(uid)) this.error.set(true);
    } finally { if (version === this.version) this.loading.set(false); }
  }
}
