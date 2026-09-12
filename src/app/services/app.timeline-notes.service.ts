import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { Firestore, collection, query, where, orderBy, documentId, limit, startAfter, getDocsFromServer } from 'app/firebase/firestore';
import type { QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppFunctionsService } from './app.functions.service';
import { AppUserService } from './app.user.service';
import type { AppUserInterface } from '../models/app-user.interface';
import {
  TIMELINE_NOTES_COLLECTION, TIMELINE_NOTE_LIMITS, decodeTimelineNote, timelineNoteOverlaps, isTimelineDate,
  type TimelineNote, type TimelineNoteRange, type TimelineNotesLoad, type SaveTimelineNoteRequest, type DeleteTimelineNoteRequest,
} from '@shared/timeline-notes';

const TIMELINE_NOTES_FRESH_MS = 60_000;
interface TimelineNotesSnapshot { uid: string; range: TimelineNoteRange; result: TimelineNotesLoad; loadedAt: number; version: number }
interface TimelineNotesRequest { uid: string; range: TimelineNoteRange; promise: Promise<TimelineNotesLoad>; version: number }
const covers = (outer: TimelineNoteRange, inner: TimelineNoteRange): boolean =>
  outer.startDate <= inner.startDate && outer.endDate >= inner.endDate;
const sameRange = (a: TimelineNoteRange, b: TimelineNoteRange): boolean => a.startDate === b.startDate && a.endDate === b.endDate;

export interface TimelineNotesPage { notes: TimelineNote[]; cursor: QueryDocumentSnapshot | null }
export interface TimelineReadPage { rows: Array<{ id: string; data: unknown }>; cursor: unknown | null }

/** Shared bounded projection; ongoing records cannot be lost behind a closed-history page. */
export async function loadTimelineNotePages(
  range: TimelineNoteRange,
  read: (ongoing: boolean, cursor: unknown | null, size: number) => Promise<TimelineReadPage>,
  isCurrent: () => boolean,
  nowMs = Date.now(),
): Promise<TimelineNotesLoad> {
  const notes = new Map<string, TimelineNote>();
  let count = 0;
  let bytes = 0;
  if (!isCurrent()) throw new Error('Timeline request was cancelled.');
  // Independent indexed queries share one network wait. Consume ongoing records first, preserving the shared caps.
  // At most one extra first page is fetched if ongoing notes alone exhaust the projection budget.
  const firstPages = await Promise.all([true, false].map(ongoing => read(ongoing, null, TIMELINE_NOTE_LIMITS.page + 1)));
  for (const [index, ongoing] of [true, false].entries()) {
    let cursor: unknown | null = null;
    do {
      if (!isCurrent()) throw new Error('Timeline request was cancelled.');
      const size = Math.min(TIMELINE_NOTE_LIMITS.page, TIMELINE_NOTE_LIMITS.records - count);
      const page = cursor === null ? firstPages[index] : await read(ongoing, cursor, size + 1);
      if (!isCurrent()) throw new Error('Timeline request was cancelled.');
      for (const row of page.rows.slice(0, size)) {
        count++;
        bytes += new TextEncoder().encode(JSON.stringify(row.data)).byteLength;
        if (bytes > TIMELINE_NOTE_LIMITS.bytes) return { notes: [...notes.values()], incomplete: 'bytes' };
        const note = decodeTimelineNote(row.id, row.data);
        if (!note) throw new Error('Timeline notes could not be read.');
        if (timelineNoteOverlaps(note, range, nowMs)) notes.set(note.id, note);
      }
      if (page.rows.length <= size) break;
      if (count >= TIMELINE_NOTE_LIMITS.records) return { notes: [...notes.values()], incomplete: 'records' };
      cursor = page.cursor;
      if (!cursor) throw new Error('Timeline paging could not continue.');
    } while (cursor !== null);
  }
  return { notes: [...notes.values()], incomplete: null };
}

@Injectable({ providedIn: 'root' })
export class AppTimelineNotesService {
  private readonly db = inject(Firestore);
  private readonly auth = inject(AppAuthService);
  private readonly functions = inject(AppFunctionsService);
  private readonly users = inject(AppUserService);
  private user: AppUserInterface | null = null;
  private generation = 0;
  private cache: TimelineNotesSnapshot | null = null;
  private readonly requests = new Set<TimelineNotesRequest>();
  private requestVersion = 0;
  readonly uid = signal<string | null>(null);
  readonly showOnCharts = signal(true);
  readonly changes$ = new Subject<void>();

  constructor() {
    this.auth.user$.pipe(takeUntilDestroyed()).subscribe(user => {
      const changed = this.uid() !== (user?.uid ?? null);
      this.user = user;
      this.uid.set(user?.uid ?? null);
      this.showOnCharts.set(user?.settings?.appSettings?.timelineNotes?.showOnCharts !== false);
      if (changed) this.invalidate();
    });
  }
  isOwner(uid: string): boolean { return !!uid && this.uid() === uid && this.auth.currentUser?.uid === uid; }
  private assertOwner(uid: string): void {
    if (!this.isOwner(uid)) throw new Error('Your account changed. Reopen Timeline notes.');
  }
  invalidate(): void { this.generation++; this.cache = null; this.requests.clear(); this.changes$.next(); }

  /** Last completed snapshot for immediate display while revalidating; never crosses account/mutation boundaries. */
  cachedRange(uid: string, range: TimelineNoteRange): TimelineNotesLoad | null {
    this.assertOwner(uid);
    const cached = this.cache;
    if (cached?.uid !== uid || !covers(cached.range, range) || (cached.result.incomplete && !sameRange(cached.range, range))) return null;
    return { ...cached.result, notes: cached.result.notes.filter(note => timelineNoteOverlaps(note, range)) };
  }

  loadRange(uid: string, range: TimelineNoteRange, refresh = false): Promise<TimelineNotesLoad> {
    this.assertOwner(uid);
    if (!isTimelineDate(range.startDate) || !isTimelineDate(range.endDate) || range.startDate > range.endDate) {
      return Promise.reject(new Error('Invalid timeline window.'));
    }
    const generation = this.generation;
    // Prefer the newest covering request, and never join one older than our completed snapshot.
    const pending = [...this.requests].reverse().find(request => request.uid === uid
      && request.version >= (this.cache?.version ?? 0) && covers(request.range, range));
    if (pending) {
      return pending.promise.then(result => {
        this.assertOwner(uid);
        if (generation !== this.generation) throw new Error('Timeline request was cancelled.');
        // A truncated broad window cannot stand in for a complete, narrower query.
        if (result.incomplete && !sameRange(pending.range, range)) return this.loadRange(uid, range, refresh);
        return { ...result, notes: result.notes.filter(note => timelineNoteOverlaps(note, range)) };
      });
    }
    const cached = this.cachedRange(uid, range);
    if (!refresh && cached && Date.now() - this.cache!.loadedAt < TIMELINE_NOTES_FRESH_MS) {
      return Promise.resolve().then(() => {
        this.assertOwner(uid);
        if (generation !== this.generation) throw new Error('Timeline request was cancelled.');
        return cached;
      });
    }
    const requestVersion = ++this.requestVersion;
    const promise = loadTimelineNotePages(range, async (ongoing, cursor, size) => {
      this.assertOwner(uid);
      const constraints: QueryConstraint[] = [
        where('startDate', '<=', range.endDate),
        ...(ongoing ? [where('endDate', '==', null)] : [where('endDate', '>=', range.startDate)]),
        orderBy('endDate', 'asc'), orderBy('startDate', 'asc'), orderBy(documentId(), 'asc'), limit(size),
      ];
      if (cursor) constraints.push(startAfter(cursor));
      const snapshot = await getDocsFromServer(query(collection(this.db, 'users', uid, TIMELINE_NOTES_COLLECTION), ...constraints));
      return { rows: snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })), cursor: snapshot.docs[size - 2] ?? null };
    }, () => this.isOwner(uid) && this.generation === generation).then(result => {
      this.assertOwner(uid);
      if (generation !== this.generation) throw new Error('Timeline request was cancelled.');
      // An older, slower request must not replace the snapshot from a more recent window/refresh.
      if (requestVersion === this.requestVersion) this.cache = { uid, range: { ...range }, result, loadedAt: Date.now(), version: requestVersion };
      return result;
    }).finally(() => { this.requests.delete(request); });
    const request = { uid, range: { ...range }, promise, version: requestVersion };
    this.requests.add(request);
    return promise;
  }

  async list(uid: string, cursor: QueryDocumentSnapshot | null = null): Promise<TimelineNotesPage> {
    this.assertOwner(uid);
    const generation = this.generation;
    const constraints: QueryConstraint[] = [orderBy('startDate', 'desc'), orderBy(documentId(), 'desc'), limit(TIMELINE_NOTE_LIMITS.page + 1)];
    if (cursor) constraints.push(startAfter(cursor));
    const snapshot = await getDocsFromServer(query(collection(this.db, 'users', uid, TIMELINE_NOTES_COLLECTION), ...constraints));
    this.assertOwner(uid);
    if (generation !== this.generation) throw new Error('Timeline request was cancelled.');
    const notes = snapshot.docs.slice(0, TIMELINE_NOTE_LIMITS.page).map(doc => decodeTimelineNote(doc.id, doc.data()));
    if (notes.some(note => !note)) throw new Error('Timeline notes could not be read.');
    return { notes: notes as TimelineNote[], cursor: snapshot.size > TIMELINE_NOTE_LIMITS.page ? snapshot.docs[TIMELINE_NOTE_LIMITS.page - 1] : null };
  }
  async get(uid: string, id: string): Promise<TimelineNote | null> {
    this.assertOwner(uid);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid note identifier.');
    const snapshot = await getDocsFromServer(query(collection(this.db, 'users', uid, TIMELINE_NOTES_COLLECTION), where(documentId(), '==', id), limit(1)));
    this.assertOwner(uid);
    return snapshot.empty ? null : decodeTimelineNote(id, snapshot.docs[0].data());
  }
  async save(uid: string, request: SaveTimelineNoteRequest): Promise<TimelineNote> {
    this.assertOwner(uid);
    const response = await this.functions.call<SaveTimelineNoteRequest & { expectedUserID: string }, TimelineNote>('saveTimelineNote', { ...request, expectedUserID: uid });
    this.assertOwner(uid);
    const note = decodeTimelineNote(response.data.id, response.data);
    if (!note) throw new Error('The note could not be read.');
    this.invalidate();
    return note;
  }
  async remove(uid: string, request: DeleteTimelineNoteRequest): Promise<void> {
    this.assertOwner(uid);
    await this.functions.call('deleteTimelineNote', { ...request, expectedUserID: uid });
    this.assertOwner(uid);
    this.invalidate();
  }
  async setShowOnCharts(uid: string, showOnCharts: boolean): Promise<void> {
    this.assertOwner(uid);
    if (typeof showOnCharts !== 'boolean' || !this.user) throw new Error('Choose a chart visibility setting.');
    await this.users.updateUserProperties(this.user, { settings: { appSettings: { timelineNotes: { showOnCharts } } } });
    this.assertOwner(uid);
    this.showOnCharts.set(showOnCharts);
  }
}
