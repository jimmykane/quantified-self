import { Injectable, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { FirebaseApp } from 'app/firebase/app';
import { Firestore, collection, collectionData, doc, docData, getCountFromServer, getDocFromServer, limit, orderBy, query, where } from 'app/firebase/firestore';
import { Subscription } from 'rxjs';
import { ACTIVITY_SEND_LIMITS, ActivitySendBatch, ActivitySendCommand, ActivitySendCommandResult, ActivitySendRow, ActivitySendSummary } from '@shared/activity-send';
import { AppUserService } from './app.user.service';
import { AppFunctionsService } from './app.functions.service';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppProcessingService } from './app.processing.service';
import { FUNCTIONS_MANIFEST } from '@shared/functions-manifest';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ActivitySendService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly app = inject(FirebaseApp);
  private readonly user = inject(AppUserService);
  private readonly functions = inject(AppFunctionsService);
  private readonly appCheck = inject(AppCheckReadinessService);
  private readonly processing = inject(AppProcessingService);
  readonly recent = signal<ActivitySendBatch[]>([]);
  readonly batch = signal<ActivitySendBatch | null>(null);
  readonly rows = signal<ActivitySendRow[]>([]);
  readonly requestedBatchId = signal<string | null>(null);
  readonly loadingBatch = signal(false);
  readonly loadingRows = signal(false);
  readonly batchReadError = signal<string | null>(null);
  readonly rowReadError = signal<string | null>(null);
  private readonly historyReadError = signal<string | null>(null);
  readonly readError = computed(() => this.batchReadError() || this.rowReadError() || this.historyReadError());
  readonly selection = signal<string[]>([]);
  readonly summary = signal<ActivitySendSummary | null>(null);
  readonly loadingSummary = signal(false);
  readonly summaryError = signal<string | null>(null);
  private summaryEpoch = 0;
  private summaryTimer?: ReturnType<typeof setTimeout>;
  private summaryInFlight = false;
  private summaryNextReadAt = 0;
  private readonly jobs = new Map<string, string>();
  private activeSubscription?: Subscription;
  private recentSubscription?: Subscription;
  private batchSubscription?: Subscription;
  private rowSubscription?: Subscription;
  private uid: string | null = null;
  private selectedId: string | null = null;
  private rowLimit = 50;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.closeBatch(); this.recentSubscription?.unsubscribe(); this.activeSubscription?.unsubscribe(); });
    effect(() => {
      const uid = this.user.user()?.uid || null;
      if (this.uid === uid) return;
      this.recentSubscription?.unsubscribe(); this.activeSubscription?.unsubscribe(); this.closeBatch();
      for (const job of this.jobs.values()) this.processing.removeJob(job);
      this.jobs.clear(); this.recent.set([]); this.selection.set([]); this.historyReadError.set(null); this.uid = uid;
      if (!uid) return;
      this.recentSubscription = collectionData(query(collection(this.firestore, `users/${uid}/activitySends`), orderBy('createdAt', 'desc'), limit(20)))
        .subscribe({ next: records => {
          if (!this.isCurrentOwner(uid)) return;
          const batches = records as unknown as ActivitySendBatch[];
          this.recent.set(batches);

        }, error: () => { if (this.isCurrentOwner(uid)) this.historyReadError.set('Could not load recent sends. Check your connection and refresh the page.'); } });
      this.activeSubscription = collectionData(query(collection(this.firestore, `users/${uid}/activitySends`), where('state', '==', 'confirmed'), limit(100))).subscribe({ next: records => { if (this.isCurrentOwner(uid)) this.syncJobs(records as unknown as ActivitySendBatch[]); }, error: () => { if (this.isCurrentOwner(uid)) this.historyReadError.set('Delivery status is unavailable. Refresh the page to check your results.'); } });
    });
  }
  setSelection(eventIds: string[]): void { this.selection.set([...new Set(eventIds)].slice(0, 50)); }
  watchBatch(id: string): void {
    this.closeBatch(); this.selectedId = id; this.requestedBatchId.set(id); this.loadingBatch.set(true); this.rowLimit = 50;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    this.batchSubscription = docData(doc(this.firestore, `users/${uid}/activitySends/${id}`)).subscribe({
      next: record => { if (this.isCurrentOwner(uid) && this.selectedId === id) {
        this.batch.set(record ? record as unknown as ActivitySendBatch : null); this.loadingBatch.set(false);
        this.batchReadError.set(record ? null : 'This send is unavailable. Check your connection or start a new send.');
        if (record && record['state'] !== 'draft') this.scheduleSummary();
      } },
      error: () => { if (this.isCurrentOwner(uid) && this.selectedId === id) { this.loadingBatch.set(false); this.batchReadError.set('This send is unavailable.'); } } });
    this.watchRows();
  }
  loadMoreRows(): void {
    if (this.loadingRows() || !this.selectedId) return;
    this.rowLimit += 50; this.watchRows();
  }
  closeBatch(): void {
    this.summaryEpoch++; clearTimeout(this.summaryTimer); this.summaryTimer = undefined;
    this.summaryInFlight = false; this.summaryNextReadAt = 0;
    this.summary.set(null); this.loadingSummary.set(false); this.summaryError.set(null);
    this.batchSubscription?.unsubscribe(); this.rowSubscription?.unsubscribe();
    this.selectedId = null; this.requestedBatchId.set(null); this.batch.set(null); this.rows.set([]); this.loadingBatch.set(false); this.loadingRows.set(false); this.batchReadError.set(null); this.rowReadError.set(null);
  }
  refreshSummary(): void {
    if (this.summaryInFlight || !this.selectedId) return;
    clearTimeout(this.summaryTimer); this.summaryTimer = undefined; this.summaryNextReadAt = 0;
    this.scheduleSummary();
  }
  private scheduleSummary(): void {
    if (this.summaryInFlight || this.summaryTimer || !this.selectedId) return;
    this.summaryTimer = setTimeout(() => { this.summaryTimer = undefined; void this.readSummary(); }, Math.max(0, this.summaryNextReadAt - Date.now()));
  }
  private async readSummary(): Promise<void> {
    const uid = this.uid, id = this.selectedId, epoch = this.summaryEpoch;
    if (!uid || !id || !this.isCurrentOwner(uid)) return;
    const current = () => this.summaryEpoch === epoch && this.selectedId === id && this.isCurrentOwner(uid);
    this.summaryInFlight = true; this.loadingSummary.set(true); this.summaryError.set(null);
    let retry = false;
    try {
      const ref = doc(this.firestore, `users/${uid}/activitySends/${id}`);
      const before = (await getDocFromServer(ref)).data() as ActivitySendBatch | undefined;
      if (!current()) return;
      if (!before || before.state === 'draft') {
        this.summary.set(null); this.summaryError.set('Delivery totals are not available for this send.'); return;
      }
      // Counts cover every row, independently of the 50-row display page. No file/queue reads.
      const groups = {
        delivered: ['delivered'], duplicate: ['duplicate'], needs_action: ['needs_action'], stopped: ['stopped'],
        pending: ['preparing', 'ready', 'queued', 'sending', 'processing', 'retrying'],
      };
      const values = await Promise.all(Object.values(groups).map(statuses => getCountFromServer(query(
        collection(this.firestore, `users/${uid}/activitySends/${id}/rows`), where('status', 'in', statuses),
      )).then(result => result.data().count)));
      if (!current()) return;
      const after = (await getDocFromServer(ref)).data() as ActivitySendBatch | undefined;
      if (!current()) return;
      const [delivered, duplicate, needs_action, stopped, pending] = values;
      // Every change between outcome groups advances the batch clock. Reject mixed snapshots and unknown states.
      if (!after || before.updatedAt !== after.updatedAt || before.total !== after.total || before.finished !== after.finished
        || before.state !== after.state || !values.every(value => Number.isSafeInteger(value) && value >= 0)
        || values.reduce((sum, value) => sum + value, 0) !== after.total
        || delivered + duplicate + needs_action + stopped !== after.finished) {
        retry = true; this.summaryError.set('Activities are updating. Totals will refresh shortly.'); return;
      }
      this.summary.set({ delivered, duplicate, needs_action, stopped, pending, checkedAt: Date.now(), updatedAt: after.updatedAt });
      retry = after.state === 'confirmed';
    } catch {
      if (current()) this.summaryError.set('Delivery totals are unavailable. Refresh totals to try again.');
    } finally {
      if (current()) {
        this.summaryInFlight = false; this.loadingSummary.set(false); this.summaryNextReadAt = Date.now() + 30_000;
        if (retry || Number(this.batch()?.updatedAt) > Number(this.summary()?.updatedAt || 0) && !this.summaryError()) this.scheduleSummary();
      }
    }
  }
  private watchRows(): void {
    this.rowSubscription?.unsubscribe();
    const uid = this.auth.currentUser?.uid; const id = this.selectedId;
    if (!uid || !id) return;
    this.loadingRows.set(true); this.rowReadError.set(null);
    this.rowSubscription = collectionData(query(collection(this.firestore, `users/${uid}/activitySends/${id}/rows`), orderBy('id'), limit(this.rowLimit))).subscribe({
      next: records => { if (this.isCurrentOwner(uid) && this.selectedId === id) { this.rows.set(records as unknown as ActivitySendRow[]); this.loadingRows.set(false); } },
      error: () => { if (this.isCurrentOwner(uid) && this.selectedId === id) { this.loadingRows.set(false); this.rowReadError.set('Could not load delivery results. Reopen this send to try again.'); } } });
  }
  private isCurrentOwner(uid: string): boolean { return this.uid === uid && this.auth.currentUser?.uid === uid; }
  async command(request: ActivitySendCommand, expectedUid?: string): Promise<ActivitySendCommandResult> {
    const uid = expectedUid || this.auth.currentUser?.uid;
    if (uid && this.auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed.');
    if (!uid) throw new Error('Sign in first.');
    const response = await this.functions.call<ActivitySendCommand, ActivitySendCommandResult>('activitySendCommand', request, { canExecute: () => this.auth.currentUser?.uid === uid });
    if (this.auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed.');
    return response.data;
  }
  async upload(batchId: string, rowId: string, file: File, progress: (value: number) => void, expectedUid?: string): Promise<void> {
    const owner = this.auth.currentUser;
    if (!owner) throw new Error('Sign in first.');
    const uid = owner.uid;
    if (expectedUid && uid !== expectedUid) throw new Error('The signed-in account changed.');
    const readFailure = 'The file could not be read. Download it to this device and select it again.';
    if (!file.size) throw new Error(readFailure);
    if (file.size > ACTIVITY_SEND_LIMITS.fileBytes) throw new Error('Choose a FIT or FIT.gz file up to 20 MiB.');
    const bytes = await new Promise<ArrayBuffer | null>(resolve => {
      try {
        const reader = new FileReader();
        reader.onerror = reader.onabort = () => resolve(null);
        reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? reader.result : null);
        reader.readAsArrayBuffer(file);
      } catch { resolve(null); }
    });
    if (uid !== this.auth.currentUser?.uid) throw new Error('The signed-in account changed.');
    if (!bytes || !bytes.byteLength || bytes.byteLength !== file.size) throw new Error(readFailure);
    // A memory-backed Blob avoids WebKit sending an empty body for a disk-backed File.
    const body = new Blob([bytes], { type: 'application/octet-stream' });
    const [token, appCheckToken] = await Promise.all([owner.getIdToken(), this.appCheck.getToken()]);
    if (uid !== this.auth.currentUser?.uid) throw new Error('The signed-in account changed.');
    const config = FUNCTIONS_MANIFEST.uploadActivitySendFile;
    const projectId = this.app.options.projectId;
    const url = environment.localhost && environment.useFunctionsEmulator
      ? `http://127.0.0.1:5001/${projectId}/${config.region}/${config.name}`
      : `https://${config.region}-${projectId}.cloudfunctions.net/${config.name}`;
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url); xhr.timeout = 150_000;
      xhr.ontimeout = () => reject(new Error('File preparation timed out. Reselect the same file to resume this draft.'));
      xhr.onabort = () => reject(new Error('File transfer was cancelled. Reselect the same file to resume this draft.'));
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (appCheckToken) xhr.setRequestHeader('X-Firebase-AppCheck', appCheckToken);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-QS-Batch', batchId); xhr.setRequestHeader('X-QS-File', rowId);
      xhr.setRequestHeader('X-QS-Filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = event => { if (uid === this.auth.currentUser?.uid && event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      xhr.onerror = () => reject(new Error('File transfer failed. Retry while this draft is open.'));
      xhr.onload = () => {
        if (uid !== this.auth.currentUser?.uid) { reject(new Error('The signed-in account changed.')); return; }
        if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
        let message = 'Could not stage this file.';
        try { message = JSON.parse(xhr.responseText).message || message; } catch { /* Keep the safe generic message. */ }
        reject(new Error(message));
      };
      xhr.send(body);
    });
  }
  private syncJobs(batches: ActivitySendBatch[]): void {
    const activeIds = new Set(batches.map(batch => batch.id));
    for (const [batch, job] of this.jobs) if (!activeIds.has(batch)) { this.processing.removeJob(job); this.jobs.delete(batch); }
    for (const batch of batches) {
      const active = batch.state === 'confirmed' && batch.finished < batch.total;
      let id = this.jobs.get(batch.id);
      if (active) {
        if (!id) { id = this.processing.addJob('upload', `Sending activities to ${batch.provider}`); this.jobs.set(batch.id, id); }
        this.processing.updateJob(id, { status: 'processing', progress: undefined, details: `${batch.finished}/${batch.total} processed. Open Send activities for results.` });
      } else if (id) { this.processing.removeJob(id); this.jobs.delete(batch.id); }
    }
  }
}
