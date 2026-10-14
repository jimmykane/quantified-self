import { Injectable, effect, inject, signal } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { FirebaseApp } from 'app/firebase/app';
import { Firestore, collection, collectionData, doc, docData, limit, orderBy, query, where } from 'app/firebase/firestore';
import { Subscription } from 'rxjs';
import { ActivitySendBatch, ActivitySendCommand, ActivitySendCommandResult, ActivitySendRow } from '@shared/activity-send';
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
  readonly readError = signal<string | null>(null);
  readonly selection = signal<string[]>([]);
  private readonly jobs = new Map<string, string>();
  private activeSubscription?: Subscription;
  private recentSubscription?: Subscription;
  private batchSubscription?: Subscription;
  private rowSubscription?: Subscription;
  private uid: string | null = null;
  private selectedId: string | null = null;
  private rowLimit = 50;

  constructor() {
    effect(() => {
      const uid = this.user.user()?.uid || null;
      if (this.uid === uid) return;
      this.recentSubscription?.unsubscribe(); this.activeSubscription?.unsubscribe(); this.closeBatch();
      for (const job of this.jobs.values()) this.processing.removeJob(job);
      this.jobs.clear(); this.recent.set([]); this.selection.set([]); this.uid = uid;
      if (!uid) return;
      this.recentSubscription = collectionData(query(collection(this.firestore, `users/${uid}/activitySends`), orderBy('createdAt', 'desc'), limit(20)))
        .subscribe({ next: records => {
          if (!this.isCurrentOwner(uid)) return;
          const batches = records as unknown as ActivitySendBatch[];
          this.recent.set(batches);

        }, error: () => { if (this.isCurrentOwner(uid)) this.readError.set('Could not load recent sends. Check your connection and reopen the page.'); } });
      this.activeSubscription = collectionData(query(collection(this.firestore, `users/${uid}/activitySends`), where('state', '==', 'confirmed'), limit(100))).subscribe({ next: records => { if (this.isCurrentOwner(uid)) this.syncJobs(records as unknown as ActivitySendBatch[]); }, error: () => { if (this.isCurrentOwner(uid)) this.readError.set('Delivery status is unavailable. Reopen Send activities to check your results.'); } });
    });
  }
  setSelection(eventIds: string[]): void { this.selection.set([...new Set(eventIds)].slice(0, 50)); }
  watchBatch(id: string): void {
    this.closeBatch(); this.selectedId = id; this.rowLimit = 50;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    this.batchSubscription = docData(doc(this.firestore, `users/${uid}/activitySends/${id}`)).subscribe({
      next: record => { if (this.isCurrentOwner(uid) && this.selectedId === id) this.batch.set(record ? record as unknown as ActivitySendBatch : null); },
      error: () => { if (this.isCurrentOwner(uid) && this.selectedId === id) this.readError.set('This send is unavailable.'); } });
    this.watchRows();
  }
  loadMoreRows(): void { this.rowLimit += 50; this.watchRows(); }
  closeBatch(): void {
    this.batchSubscription?.unsubscribe(); this.rowSubscription?.unsubscribe();
    this.selectedId = null; this.batch.set(null); this.rows.set([]); this.readError.set(null);
  }
  private watchRows(): void {
    this.rowSubscription?.unsubscribe();
    const uid = this.auth.currentUser?.uid; const id = this.selectedId;
    if (!uid || !id) return;
    this.rowSubscription = collectionData(query(collection(this.firestore, `users/${uid}/activitySends/${id}/rows`), orderBy('id'), limit(this.rowLimit))).subscribe({
      next: records => { if (this.isCurrentOwner(uid) && this.selectedId === id) this.rows.set(records as unknown as ActivitySendRow[]); },
      error: () => { if (this.isCurrentOwner(uid) && this.selectedId === id) this.readError.set('Could not load delivery results. Reopen this send to try again.'); } });
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
    if (expectedUid && owner.uid !== expectedUid) throw new Error('The signed-in account changed.');
    const [token, appCheckToken] = await Promise.all([owner.getIdToken(), this.appCheck.getToken()]);
    if (owner.uid !== this.auth.currentUser?.uid) throw new Error('The signed-in account changed.');
    const config = FUNCTIONS_MANIFEST.uploadActivitySendFile;
    const projectId = this.app.options.projectId;
    const url = environment.localhost && environment.useFunctionsEmulator
      ? `http://127.0.0.1:5001/${projectId}/${config.region}/${config.name}`
      : `https://${config.region}-${projectId}.cloudfunctions.net/${config.name}`;
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url); xhr.timeout = 150_000;
      xhr.ontimeout = () => reject(new Error('File preparation timed out. Reselect the same file to resume this draft.'));
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (appCheckToken) xhr.setRequestHeader('X-Firebase-AppCheck', appCheckToken);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-QS-Batch', batchId); xhr.setRequestHeader('X-QS-File', rowId);
      xhr.setRequestHeader('X-QS-Filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = event => { if (owner.uid === this.auth.currentUser?.uid && event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      xhr.onerror = () => reject(new Error('File transfer failed. Retry while this draft is open.'));
      xhr.onload = () => {
        if (owner.uid !== this.auth.currentUser?.uid) { reject(new Error('The signed-in account changed.')); return; }
        if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
        let message = 'Could not stage this file.';
        try { message = JSON.parse(xhr.responseText).message || message; } catch { /* Keep the safe generic message. */ }
        reject(new Error(message));
      };
      xhr.send(file);
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
        this.processing.updateJob(id, { status: 'processing', progress: undefined, details: `${batch.finished}/${batch.total} finished. Open Send activities for results.` });
      } else if (id) { this.processing.removeJob(id); this.jobs.delete(batch.id); }
    }
  }
}
