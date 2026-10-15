import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import dayjs from 'dayjs';
import { afterNextRender, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MaterialModule } from '../../modules/material.module';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { ActivitySendService } from '../../services/activity-send.service';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { ACTIVITY_SEND_LIMITS, ActivitySendCommand, ActivitySendCommandResult, ActivitySendProvider, ActivitySendRow, isActivitySendProvider } from '@shared/activity-send';

@Component({ selector: 'app-activity-send-page', standalone: true, imports: [CommonModule, FormsModule, RouterModule, MaterialModule, AppChartSharedModule, PageHeaderComponent], templateUrl: './activity-send-page.component.html', styleUrl: './activity-send-page.component.scss' })
export class ActivitySendPageComponent {
  readonly sends = inject(ActivitySendService);
  readonly users = inject(AppUserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = inject(BrowserCompatibilityService);
  private destroyed = false;
  readonly selectionChanged = signal(false);
  readonly provider = signal<ActivitySendProvider | null>(null);
  readonly source = signal<'files' | 'saved'>('files');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly transfer = signal<{ name: string; progress: number } | null>(null);
  readonly nowMs = signal(Date.now());
  readonly showDetails = signal(false);
  readonly sendingClosed = computed(() => {
    const batch = this.sends.batch();
    return !!batch && (batch.stopped === true || typeof batch.expiresAt === 'number' && batch.expiresAt <= this.nowMs());
  });
  readonly canRetry = computed(() => this.users.hasProAccessSignal() && !this.sendingClosed());
  readonly canEditSelection = computed(() => !this.sends.requestedBatchId() || !!this.sends.batch());
  readonly readyCount = computed(() => this.sends.batch()?.state === 'draft' ? Math.max(0, this.sends.batch()!.total - this.sends.batch()!.finished) : 0);
  readonly canConfirm = computed(() => this.users.hasProAccessSignal() && !this.sendingClosed() && !this.busy() && !this.sends.loadingBatch() && !this.sends.loadingRows() && !this.sends.batchReadError() && !this.sends.rowReadError() && this.sends.rows().length > 0 && this.sends.batch()?.state === 'draft' && !!this.sends.batch()?.reviewed && !this.selectionChanged() && this.readyCount() > 0);
  readonly hasRetryableRows = computed(() => this.sends.rows().some(row => ['upgrade', 'reconnect', 'retry_send'].includes(row.recovery)));
  readonly recentForProvider = computed(() => this.sends.recent().filter(batch => !this.provider() || batch.provider === this.provider()));
  readonly statusLabels = { preparing: 'Preparing', ready: 'Ready', queued: 'Queued', sending: 'Sending', processing: 'Waiting for provider', delivered: 'Delivered', duplicate: 'Already exists or queued', needs_action: 'Needs action', stopped: 'Stopped' };
  readonly providerOptions: ActivitySendProvider[] = ['suunto', 'coros', 'wahoo'];
  readonly sourceOptions = ['Garmin API', 'Suunto app', 'COROS API', 'Wahoo API', 'manualUpload'];
  readonly fileReferences = new Map<File, string>();
  startDate = '';
  endDate = '';
  savedSources: string[] = [];
  private activeOwner: string | null = null;
  private activeProvider: ActivitySendProvider | null = null;
  private activeSource: 'files' | 'saved' = 'files';
  private activeBatch: string | null = null;
  private routeBatchId: string | null = null;
  private readonly sendingClock = afterNextRender(() => {
    const handle = globalThis.setInterval(() => this.nowMs.set(Date.now()), 60_000);
    this.destroyRef.onDestroy(() => globalThis.clearInterval(handle));
  });
  constructor() {
    effect(() => { const uid = this.users.user()?.uid; if (!uid || uid !== this.activeOwner) this.fileReferences.clear(); });
    effect(() => {
      const batch = this.sends.batch();
      if (!batch || this.busy() || batch.provider === this.provider() && batch.source === this.source()) return;
      // A saved batch owns its destination and source, including copied deep links.
      void this.router.navigate(['/send-activities', batch.provider], { queryParams: { batch: batch.id, source: batch.source }, replaceUrl: true });
    });
    const navigationState = this.router.getCurrentNavigation()?.extras.state;
    if (navigationState?.['activitySendOwner'] === this.users.user()?.uid && Array.isArray(navigationState?.['activitySendSelection'])) this.sends.setSelection(navigationState['activitySendSelection']);
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const value = params.get('provider');
      const provider = isActivitySendProvider(value) ? value : null;
      if (provider !== this.provider()) {
        this.selectionChanged.set(false);
        if (this.busy()) this.activeOwner = null;
      }
      this.provider.set(provider);
      if (value && !isActivitySendProvider(value)) void this.router.navigate(['/send-activities'], { replaceUrl: true });
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.error.set(null);
      this.showDetails.set(false);
      const source = params.get('source') === 'saved' ? 'saved' : 'files';
      const requested = params.get('batch');
      const id = requested && /^[A-Za-z0-9_-]{1,128}$/.test(requested) ? requested : null;
      const contextChanged = source !== this.source() || id !== this.routeBatchId;
      if (contextChanged) {
        this.selectionChanged.set(false);
        // The draft-opening navigation is the only context change owned by this action.
        // Fence user navigation even before create returns an active batch.
        if (this.busy() && (source !== this.activeSource || id !== this.activeBatch)) this.activeOwner = null;
      }
      this.routeBatchId = id; this.source.set(source);
      if (id) this.sends.watchBatch(id);
      else this.sends.closeBatch();
    });
    this.destroyRef.onDestroy(() => { this.destroyed = true; this.sends.closeBatch(); });
  }
  async chooseProvider(provider: ActivitySendProvider): Promise<void> {
    if (provider === this.provider()) return;
    if (await this.router.navigate(['/send-activities', provider], { queryParams: { source: this.source() } })) { this.selectionChanged.set(false); this.haptics.selection(); }
  }
  async chooseSource(source: 'files' | 'saved'): Promise<void> {
    if (source === this.source()) return;
    if (await this.router.navigate([], { relativeTo: this.route, queryParams: { source } })) { this.selectionChanged.set(false); this.haptics.selection(); }
  }
  async openBatch(id: string, provider: ActivitySendProvider): Promise<void> {
    if (await this.router.navigate(['/send-activities', provider], { queryParams: { batch: id, source: this.sends.recent().find(batch => batch.id === id)?.source || 'files' } })) { this.selectionChanged.set(false); this.haptics.selection(); }
  }
  async newDraft(): Promise<void> {
    if (await this.router.navigate([], { relativeTo: this.route, queryParams: { source: this.source() } })) { this.selectionChanged.set(false); this.haptics.selection(); }
  }
  private async ensureDraft(): Promise<string> {
    this.assertActive();
    if (!this.canEditSelection()) throw new Error('This send is still loading or unavailable. Reopen it or start a new send.');
    const current = this.sends.batch();
    if (current?.state === 'draft') {
      if (current.stopped || current.expiresAt && current.expiresAt <= Date.now()) throw new Error('The sending window closed. Start a new send.');
      this.activeBatch = current.id; return current.id;
    }
    const provider = this.provider(); if (!provider) throw new Error('Choose a destination first.');
    const id = this.browser.createRandomUUID();
    if (!id) throw new Error('This browser cannot create a safe send reference. Please update your browser.');
    await this.command({ version: 1, action: 'create', batchId: id, provider, source: this.source() });
    this.assertActive(); this.activeBatch = id;
    const opened = await this.router.navigate([], { relativeTo: this.route, queryParams: { batch: id, source: this.source() }, replaceUrl: true });
    this.assertActive();
    if (!opened) throw new Error('This draft could not be opened. Reopen it from Recent sends before preparing activities.');
    return id;
  }
  preventDrop(event: DragEvent): void { event.preventDefault(); }
  async addFiles(event: Event | DragEvent): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.users.hasProAccessSignal()) { this.error.set('Wait for file preparation to finish before adding more files.'); return; }
    const files = Array.from((event as DragEvent).dataTransfer?.files || (event.target as HTMLInputElement)?.files || []);
    if (!files.length) return;
    await this.run(async () => {
      if (files.length > ACTIVITY_SEND_LIMITS.files || files.some(file => file.size > ACTIVITY_SEND_LIMITS.fileBytes || !/\.fit(?:\.gz)?$/i.test(file.name))) throw new Error('Choose up to 50 FIT or FIT.gz files, each up to 20 MiB.');
      const id = await this.ensureDraft();
      for (const file of files) {
        this.assertActive();
        const rowId = this.fileReferences.get(file) || this.browser.createRandomUUID()!; this.fileReferences.set(file, rowId);
        this.transfer.set({ name: file.name, progress: 0 });
        await this.sends.upload(id, rowId, file, progress => { if (this.isActive()) this.transfer.set({ name: file.name, progress }); }, this.activeOwner!);
      }
      this.assertActive();
      await this.command({ version: 1, action: 'prepare', batchId: id });
    });
    this.transfer.set(null);
    if ('value' in (event.target || {})) (event.target as HTMLInputElement).value = '';
  }
  changeSavedSources(sources: string[]): void {
    if (JSON.stringify([...sources].sort()) === JSON.stringify([...this.savedSources].sort())) return;
    this.savedSources = sources; this.haptics.selection(); this.invalidateSaved();
  }
  clearSelection(): void { this.sends.setSelection([]); this.haptics.selection(); this.invalidateSaved(); }
  invalidateSaved(): void {
    const batch = this.sends.batch();
    if (batch?.source === 'saved' && !batch.savedSelectionReady && !batch.total) return;
    this.selectionChanged.set(true); if (batch) this.error.set('Sources or dates changed. Start a new draft to review this selection.');
  }
  async previewSaved(): Promise<void> {
    await this.run(async () => {
      if (this.selectionChanged()) { this.sends.closeBatch(); this.selectionChanged.set(false); }
      const ids = this.sends.selection();
      if (!ids.length && (!dayjs(this.startDate).isValid() || !dayjs(this.endDate).isValid() || dayjs(this.startDate).isAfter(dayjs(this.endDate)))) throw new Error('Choose valid From and To dates before previewing saved activities.');
      const id = await this.ensureDraft(); let cursor: string | undefined;
      do {
        this.assertActive();
        const result = await this.command({ version: 1, action: 'prepare', batchId: id, ...(ids.length ? { eventIds: ids } : { startDate: dayjs(this.startDate).startOf('day').toISOString(), endDate: dayjs(this.endDate).endOf('day').toISOString() }), ...(this.savedSources.length ? { sources: this.savedSources } : {}), ...(cursor ? { cursor } : {}) });
        this.assertActive();
        cursor = result.nextCursor || undefined;
      } while (cursor);
    });
  }
  async reviewFiles(): Promise<void> {
    const batch = this.sends.batch();
    if (batch?.state !== 'draft' || this.sendingClosed()) return;
    await this.run(async () => {
      let nextCursor: string | null | undefined;
      do {
        this.assertActive();
        const result = await this.command({ version: 1, action: 'prepare', batchId: batch.id });
        this.assertActive(); nextCursor = result.nextCursor;
      } while (batch.source === 'saved' && nextCursor);
    });
  }
  async confirm(): Promise<void> {
    this.nowMs.set(Date.now());
    if (!this.canConfirm()) return;
    const batch = this.sends.batch()!;
    await this.run(() => this.command({ version: 1, action: 'confirm', batchId: batch.id, revision: batch.revision }));
  }
  async rowAction(row: ActivitySendRow, action: 'remove' | 'check' | 'retry'): Promise<void> {
    this.nowMs.set(Date.now());
    if (action === 'retry' && !this.canRetry()) return;
    const batch = this.sends.batch(); if (!batch) return;
    await this.run(() => this.command({ version: 1, action, batchId: batch.id, rowId: row.id }));
  }
  async stop(): Promise<void> {
    const batch = this.sends.batch(); if (batch) await this.run(() => this.command({ version: 1, action: 'stop', batchId: batch.id }));
  }
  toggleDetails(): void { this.showDetails.update(value => !value); this.haptics.selection(); }
  private command(request: ActivitySendCommand): Promise<ActivitySendCommandResult> {
    this.assertActive();
    return this.sends.command(request, this.activeOwner!);
  }
  private isActive(): boolean {
    return !this.destroyed && !!this.activeOwner && this.users.user()?.uid === this.activeOwner
      && this.provider() === this.activeProvider && this.source() === this.activeSource
      && (!this.sends.batch() || !this.activeBatch || this.sends.batch()!.id === this.activeBatch);
  }
  private assertActive(): void { if (!this.isActive()) throw new Error('This sending view or signed-in account changed. Reopen your draft to continue.'); }
  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.busy() || !this.users.user()?.uid) return;
    this.activeOwner = this.users.user()!.uid; this.activeProvider = this.provider(); this.activeSource = this.source(); this.activeBatch = this.sends.batch()?.id || null;
    this.busy.set(true); this.error.set(null); this.haptics.selection();
    try { await action(); if (this.isActive()) this.haptics.success(); }
    catch (error) { if (this.isActive()) { this.error.set(error instanceof Error ? error.message : 'Could not complete this action.'); this.haptics.error(); } }
    finally { this.busy.set(false); }
  }
}
