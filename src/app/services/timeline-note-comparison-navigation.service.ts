import { Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { TimelineNotesListState } from '../components/timeline-notes/timeline-notes-dialog.component';
import { AppTimelineNotesService } from './app.timeline-notes.service';

/** Transient owner-scoped return context. Private note content/cursors never enter URLs or storage. */
@Injectable({ providedIn: 'root' })
export class TimelineNoteComparisonNavigationService {
  private readonly router = inject(Router);
  private readonly notes = inject(AppTimelineNotesService);
  private context: { uid: string; url: string; list: TimelineNotesListState } | null = null;
  constructor() {
    effect(() => { if (this.context?.uid !== this.notes.uid()) this.context = null; });
  }
  async compare(uid: string, noteId: string, list: TimelineNotesListState): Promise<boolean> {
    if (!this.notes.isOwner(uid) || !/^[a-f0-9]{64}$/.test(noteId)) return false;
    const context = { uid, url: this.router.url, list };
    this.context = context;
    try {
      const navigated = await this.router.navigate(['/health/compare', noteId]);
      if (!navigated && this.context === context) this.context = null;
      return navigated;
    } catch {
      if (this.context === context) this.context = null;
      return false;
    }
  }
  async returnToNotes(uid: string): Promise<TimelineNotesListState | null> {
    if (!this.notes.isOwner(uid)) return null;
    const context = this.context?.uid === uid ? this.context : null;
    const url = context?.url || '/health';
    if (!await this.router.navigateByUrl(url) || !this.notes.isOwner(uid) || this.router.url !== url) return null;
    if (this.context === context) this.context = null;
    return context?.list || { page: 0, cursors: [null] };
  }
}
