import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import type { MarketingCampaignDraft, MarketingCampaignListResponse, MarketingCampaignPreview, MarketingCampaignView, MarketingDocument, MarketingPlan } from '../../../../../shared/admin-marketing';
import { canDeleteMarketingCampaign, DEFAULT_MARKETING_SENDER_NAME, MARKETING_SENDER_EMAIL, MARKETING_SENDER_NAME_MAX_LENGTH } from '../../../../../shared/admin-marketing';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { validateMarketingSchedule } from '../../../../../shared/marketing-schedule';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MarketingRichEditorComponent } from './marketing-rich-editor.component';
import { hasVisibleMarketingText } from './marketing-editor';
import { openPreviewLinksOutsideFrame } from './marketing-preview-links';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../../confirmation-dialog/confirmation-dialog.component';
import { firstValueFrom } from 'rxjs';

function emptyDraft(): MarketingCampaignDraft {
  return { name: '', subject: '', senderName: DEFAULT_MARKETING_SENDER_NAME, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
    cta: null, filters: { plans: ['free', 'basic', 'pro'], signupFrom: null, signupTo: null }, schedule: null };
}
function deleteLabel(campaign: MarketingCampaignView | null): string {
  return campaign?.status === 'deleting' ? 'Retry deletion' : campaign?.status === 'draft' ? 'Delete draft' : 'Delete campaign';
}

@Component({
  selector: 'app-admin-marketing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule, MatCardModule, MatCheckboxModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatButtonToggleModule,
    MatSlideToggleModule, MatSelectModule, MatDialogModule, MatTooltipModule, MarketingRichEditorComponent, PageHeaderComponent],
  templateUrl: './admin-marketing.component.html',
  styleUrls: ['./admin-marketing.component.scss'],
})
export class AdminMarketingComponent implements OnInit, OnDestroy {
  @ViewChild('emailPreviewFrame') private emailPreviewFrame?: ElementRef<HTMLIFrameElement>;
  private readonly functions = inject(AppFunctionsService);
  private readonly haptics = inject(AppHapticsService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly dialog = inject(MatDialog);
  private deleteDialog: MatDialogRef<ConfirmationDialogComponent, boolean> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewSequence = 0;
  private refreshSequence = 0;
  private destroyed = false;
  readonly loading = signal(true);
  list: MarketingCampaignListResponse | null = null;
  selected: MarketingCampaignView | null = null;
  draft = emptyDraft();
  dirty = false;
  showCta = false;
  ctaLabel = '';
  ctaUrl = '';
  testTo = '';
  cap = 10;
  busy = '';
  confirmingDelete = false;
  readonly deletingCampaignId = signal<string | null>(null);
  error = '';
  notice = '';
  readonly senderEmail = MARKETING_SENDER_EMAIL;
  readonly senderNameMaxLength = MARKETING_SENDER_NAME_MAX_LENGTH;
  preview: MarketingCampaignPreview | null = null;
  trustedPreviewHtml: SafeHtml | null = null;
  previewBusy = false;
  previewError = '';
  activePreview: 'desktop' | 'phone' | 'text' = 'desktop';
  readonly plans: MarketingPlan[] = ['free', 'basic', 'pro'];
  private readonly localTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  timeZones = [...new Set(['UTC', this.localTimeZone, ...BrowserCompatibilityService.getSupportedTimeZones()])].sort();
  scheduleMode: 'now' | 'daily' = 'now';
  scheduleTime = '09:00';
  scheduleTimeZone = this.localTimeZone;
  get scheduleError(): string {
    try { validateMarketingSchedule(this.scheduleMode === 'daily' ? { time: this.scheduleTime, timeZone: this.scheduleTimeZone } : null); return ''; }
    catch (error) { return this.message(error); }
  }
  get nextDailyBatch(): string | null {
    if (!this.selected?.schedule || !this.selected.nextScheduledSendAt) return null;
    const instant = Date.parse(this.selected.nextScheduledSendAt);
    // A quota-exhausted or missed occurrence can leave a past cursor. Do not
    // present that timestamp as the next future sending time.
    if (!Number.isFinite(instant) || instant <= Date.now()) return null;
    return new Date(instant).toLocaleString(undefined,
      { timeZone: this.selected.schedule.timeZone, timeZoneName: 'short' });
  }

  ngOnInit(): void { void this.refresh(); }
  ngOnDestroy(): void {
    this.destroyed = true; this.clearPreviewTimer(); this.previewSequence++;
    this.deleteDialog?.close(false);
  }
  changePreview(view: 'desktop' | 'phone' | 'text'): void {
    if (this.activePreview === view) return;
    this.activePreview = view;
    this.haptics.selection();
    if (view !== 'text' && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.resizePreviewFrame());
    }
  }

  resizePreviewFrame(): void {
    const frame = this.emailPreviewFrame?.nativeElement;
    const document = frame?.contentDocument;
    if (!frame || !document) return;
    // The static sandbox keeps scripts and forms disabled. Same-origin access lets the
    // parent size the email and open its links outside the preview frame.
    openPreviewLinksOutsideFrame(document);
    frame.style.height = '1px';
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    frame.style.height = `${Number.isFinite(height) ? Math.max(360, height + 2) : 650}px`;
  }

  get canEdit(): boolean { return this.canEditAudience || this.selected?.status === 'paused'; }
  get canDelete(): boolean { return canDeleteMarketingCampaign(this.selected); }
  get selectedDeleteLabel(): string { return deleteLabel(this.selected); }
  get campaignRows() {
    return (this.list?.campaigns || []).map(campaign => ({ campaign,
      canDelete: canDeleteMarketingCampaign(campaign), deleteLabel: deleteLabel(campaign) }));
  }
  get canEditAudience(): boolean { return !this.selected || this.selected.status === 'draft'; }
  get canResume(): boolean { return this.selected?.status === 'paused' && !this.dirty && this.selected.lastTestState === 'SUCCESS'; }
  get canRetryPreparation(): boolean {
    if (this.selected?.status !== 'preparing') return false;
    const started = Date.parse(this.selected.updatedAt);
    return !Number.isFinite(started) || Date.now() - started >= 11 * 60_000;
  }
  get remaining(): number { return this.list ? Math.max(0, this.list.dailyCap - this.list.usedToday) : 0; }
  get canSendTest(): boolean { return this.selected?.status !== 'deleting' && !!this.testTo.trim() && !!this.preview && !this.previewBusy && !this.previewError; }
  get counts() { return this.selected?.stats; }
  get exclusions() { return this.selected?.exclusions; }

  async refresh(): Promise<'loaded' | 'failed' | 'stale'> {
    const sequence = ++this.refreshSequence;
    this.loading.set(true);
    this.error = '';
    try {
      const result = await this.functions.call<undefined, MarketingCampaignListResponse>('listMarketingCampaigns');
      if (this.destroyed || sequence !== this.refreshSequence) return 'stale';
      this.list = result.data;
      this.error = '';
      this.cap = result.data.dailyCap;
      if (this.selected) {
        const fresh = result.data.campaigns.find(item => item.id === this.selected?.id);
        if (fresh) this.updateSelected(fresh);
      }
      return 'loaded';
    } catch (error) {
      if (this.destroyed || sequence !== this.refreshSequence) return 'stale';
      this.error = this.message(error);
      return 'failed';
    } finally {
      if (!this.destroyed && sequence === this.refreshSequence) this.loading.set(false);
    }
  }
  choose(campaign: MarketingCampaignView, feedback = true): void {
    if (feedback && this.selected?.id !== campaign.id) this.haptics.selection();
    const recipient = feedback ? campaign.lastTestTo || '' : this.testTo || campaign.lastTestTo || '';
    this.loadCampaign(campaign, recipient);
    this.error = '';
    this.notice = '';
  }
  private loadCampaign(campaign: MarketingCampaignView, testRecipient: string): void {
    this.selected = campaign;
    this.draft = { name: campaign.name, subject: campaign.subject, senderName: campaign.senderName ?? DEFAULT_MARKETING_SENDER_NAME, content: campaign.content,
      cta: campaign.cta, filters: { ...campaign.filters, plans: [...campaign.filters.plans] }, schedule: campaign.schedule || null };
    this.scheduleMode = campaign.schedule ? 'daily' : 'now';
    this.scheduleTime = campaign.schedule?.time || '09:00';
    this.scheduleTimeZone = campaign.schedule?.timeZone || this.localTimeZone;
    if (!this.timeZones.includes(this.scheduleTimeZone)) this.timeZones = [...this.timeZones, this.scheduleTimeZone].sort();
    this.dirty = false;
    this.showCta = !!campaign.cta;
    this.ctaLabel = campaign.cta?.label || '';
    this.ctaUrl = campaign.cta?.url || '';
    this.testTo = testRecipient;
    this.resetPreview();
    this.schedulePreview();
  }
  private updateSelected(campaign: MarketingCampaignView): void {
    const savedDraft = { name: campaign.name, subject: campaign.subject, senderName: campaign.senderName ?? DEFAULT_MARKETING_SENDER_NAME, content: campaign.content,
      cta: campaign.cta, filters: campaign.filters, schedule: campaign.schedule || null };
    if (!this.dirty && JSON.stringify(this.collectDraft()) !== JSON.stringify(savedDraft)) {
      this.loadCampaign(campaign, this.testTo);
    } else {
      this.selected = campaign;
    }
  }
  newDraft(feedback = true): void {
    if (feedback && (this.selected || this.draft.name || this.draft.subject)) this.haptics.selection();
    this.selected = null;
    this.draft = emptyDraft();
    this.scheduleMode = 'now';
    this.scheduleTime = '09:00';
    this.scheduleTimeZone = this.localTimeZone;
    this.dirty = false;
    this.showCta = false;
    this.ctaLabel = '';
    this.ctaUrl = '';
    this.testTo = '';
    this.resetPreview();
    this.error = '';
    this.notice = '';
  }
  togglePlan(plan: MarketingPlan, checked: boolean): void {
    if (this.busy || !this.canEditAudience || this.draft.filters.plans.includes(plan) === checked) return;
    this.haptics.selection();
    this.draft.filters.plans = checked
      ? [...new Set([...this.draft.filters.plans, plan])]
      : this.draft.filters.plans.filter(item => item !== plan);
    this.markDirty();
  }
  markDirty(): void { this.dirty = true; this.schedulePreview(); }
  onContentChange(content: MarketingDocument): void {
    if (this.busy || !this.canEdit) return;
    this.draft.content = content;
    this.markDirty();
  }
  setCta(enabled: boolean): void {
    if (this.busy || !this.canEdit || this.showCta === enabled) return;
    this.showCta = enabled;
    this.haptics.selection();
    this.markDirty();
  }
  setScheduleMode(mode: 'now' | 'daily'): void {
    if (this.busy || !this.canEdit || mode === this.scheduleMode) return;
    this.scheduleMode = mode;
    this.haptics.selection();
    this.markDirty();
  }
  setScheduleTimeZone(timeZone: string): void {
    if (this.busy || !this.canEdit || timeZone === this.scheduleTimeZone) return;
    this.scheduleTimeZone = timeZone;
    this.haptics.selection();
    this.markDirty();
  }
  private collectDraft(): MarketingCampaignDraft {
    return { name: this.draft.name, subject: this.draft.subject, senderName: this.draft.senderName,
      content: this.draft.content,
      cta: this.showCta ? { label: this.ctaLabel, url: this.ctaUrl } : null,
      filters: { plans: [...this.draft.filters.plans], signupFrom: this.draft.filters.signupFrom || null,
        signupTo: this.draft.filters.signupTo || null },
      schedule: this.scheduleMode === 'daily' ? { time: this.scheduleTime, timeZone: this.scheduleTimeZone } : null };
  }
  private message(error: unknown): string {
    const candidate = error as { message?: string };
    return candidate?.message || 'The request failed. Please try again.';
  }
  private async run<T>(label: string, request: () => Promise<T>, success: (result: T) => void): Promise<void> {
    if (this.busy || this.destroyed) return;
    // A read started before this mutation must not restore its older saved
    // message or test result while the mutation is pending or after it completes.
    this.refreshSequence++;
    this.loading.set(false);
    this.busy = label; this.error = ''; this.notice = '';
    try {
      const result = await request();
      if (this.destroyed) return;
      success(result); await this.refresh();
      if (!this.destroyed) this.haptics.success();
    }
    catch (error) { if (!this.destroyed) { this.error = this.message(error); this.haptics.error(); } }
    finally { this.busy = ''; }
  }
  async save(): Promise<void> {
    if (!this.canEdit || this.scheduleError || this.senderNameError) return;
    await this.run('Saving', async () => (await this.functions.call('saveMarketingCampaign',
      { id: this.selected?.id || null, draft: this.collectDraft() })).data as MarketingCampaignView,
      campaign => { this.choose(campaign, false); this.notice = campaign.status === 'paused'
        ? 'Changes saved. Send a new test before resuming.' : 'Draft saved.'; });
  }
  private clearPreviewTimer(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }
  private resetPreview(): void {
    this.clearPreviewTimer();
    this.previewSequence++;
    this.preview = null;
    this.trustedPreviewHtml = null;
    this.previewError = '';
    this.previewBusy = false;
  }
  schedulePreview(): void {
    this.clearPreviewTimer();
    const sequence = ++this.previewSequence;
    this.preview = null;
    this.trustedPreviewHtml = null;
    this.previewError = '';
    if (!this.draft.subject.trim() || !hasVisibleMarketingText(this.draft.content)) {
      this.previewBusy = false;
      return;
    }
    if (this.senderNameError) {
      this.previewBusy = false;
      this.previewError = this.senderNameError;
      return;
    }
    if (this.showCta && (!this.ctaLabel.trim() || !this.ctaUrl.trim())) {
      this.previewBusy = false;
      this.previewError = 'Add both a button label and HTTPS destination to preview this email.';
      return;
    }
    this.previewBusy = true;
    this.previewTimer = setTimeout(() => { void this.renderPreview(sequence); }, 900);
  }
  private async renderPreview(sequence: number): Promise<void> {
    const draft = this.collectDraft();
    const previewDraft = { ...draft, name: draft.name.trim() || 'Preview', schedule: null,
      filters: { plans: draft.filters.plans.length ? draft.filters.plans : this.plans,
        signupFrom: null, signupTo: null } };
    this.previewBusy = true;
    try {
      const result = await this.functions.call<unknown, MarketingCampaignPreview>(
        'previewMarketingCampaign', { draft: previewDraft });
      if (this.destroyed || sequence !== this.previewSequence) return;
      this.preview = result.data;
      // The admin-only renderer validates and escapes draft content before adding the fixed
      // email template. Keep its CSS intact inside an iframe with scripts and forms disabled.
      this.trustedPreviewHtml = this.sanitizer.bypassSecurityTrustHtml(result.data.html);
      this.previewError = '';
    } catch (error) {
      if (this.destroyed || sequence !== this.previewSequence) return;
      this.preview = null;
      this.trustedPreviewHtml = null;
      this.previewError = this.message(error);
    } finally {
      if (sequence === this.previewSequence) this.previewBusy = false;
    }
  }
  get senderNameError(): string {
    if (!this.draft.senderName?.trim()) return 'Enter a sender name.';
    return this.draft.senderName.trim().length > this.senderNameMaxLength
      ? `Use ${this.senderNameMaxLength} characters or fewer for the sender name.` : '';
  }
  async prepare(): Promise<void> { await this.campaignAction('prepareMarketingCampaign', 'Preparing audience', 'Audience frozen. Review counts, then send a test.'); }
  async sendTest(): Promise<void> {
    const to = this.testTo.trim();
    const saved = this.selected && !this.dirty;
    const draft = this.collectDraft();
    const previewDraft = { ...draft, name: draft.name.trim() || 'Test message', schedule: null,
      filters: { plans: draft.filters.plans.length ? draft.filters.plans : this.plans,
        signupFrom: null, signupTo: null } };
    await this.run('Sending test', async () => (await this.functions.call('sendMarketingTest',
      saved ? { id: this.selected!.id, to, draft } : { id: null, to, draft: previewDraft })).data,
      () => { this.notice = saved
        ? `Test submitted to ${to}. Refresh until SMTP acceptance appears.`
        : `Test submitted to ${to}. Check that inbox for delivery.`; });
  }
  async change(action: 'start' | 'pause' | 'resume' | 'retry'): Promise<void> {
    if (!this.selected || (action === 'resume' && !this.canResume)) return;
    const expectedDraft = action === 'start' || action === 'resume' ? this.collectDraft() : null;
    await this.run(action, async () => (await this.functions.call('changeMarketingCampaignStatus',
      { id: this.selected!.id, action, ...(expectedDraft ? { draft: expectedDraft } : {}) })).data as MarketingCampaignView,
      campaign => { this.updateSelected(campaign); this.notice = campaign.schedule && (action === 'start' || action === 'resume')
        ? `Daily sending enabled at ${campaign.schedule.time} (${campaign.schedule.timeZone}).`
        : `Campaign ${action} request completed.`; });
  }
  async clone(): Promise<void> { await this.campaignAction('cloneMarketingCampaign', 'Cloning', 'Campaign copied as a new draft.'); }
  async deleteCampaign(campaign?: MarketingCampaignView): Promise<void> {
    const target = campaign || this.selected;
    if (!canDeleteMarketingCampaign(target) || !target || this.busy || this.loading() || this.confirmingDelete || this.destroyed) return;
    const id = target.id;
    const name = target.name;
    const kind = target.status === 'draft' ? 'draft' : 'campaign';
    const discardsEdits = this.selected?.id === id && this.dirty;
    this.confirmingDelete = true;
    this.haptics.selection();
    this.deleteDialog = this.dialog.open<ConfirmationDialogComponent, ConfirmationDialogData, boolean>(ConfirmationDialogComponent, {
      width: '440px', maxWidth: 'calc(100vw - 32px)',
      data: { title: `Delete ${kind}?`, message: `Delete “${name}”? ${discardsEdits ? `This also discards unsaved edits to this ${kind}. ` : ''}Any prepared recipient list is also removed. This cannot be undone. Test emails already submitted will still send and count toward the daily limit.`,
        confirmText: `Delete ${kind}`, cancelText: 'Cancel', confirmColor: 'warn' },
    });
    let confirmed: boolean | undefined;
    try { confirmed = await firstValueFrom(this.deleteDialog.afterClosed()); }
    finally { this.confirmingDelete = false; this.deleteDialog = null; }
    const current = campaign ? this.list?.campaigns.find(item => item.id === id) : this.selected;
    if (confirmed !== true || this.destroyed || this.busy || current?.id !== id || !canDeleteMarketingCampaign(current)) return;
    this.deletingCampaignId.set(id);
    try {
      await this.run('Deleting campaign', async () => {
        try { return (await this.functions.call('changeMarketingCampaignStatus', { id, action: 'delete' })).data; }
        catch (error) {
          // Cleanup can fail after the backend has locked the campaign. Refresh to
          // expose its retry action and disable edits, preserving the actual error.
          if (!this.destroyed) await this.refresh();
          throw error;
        }
      }, () => {
        if (this.list) this.list = { ...this.list, campaigns: this.list.campaigns.filter(item => item.id !== id) };
        if (this.selected?.id === id) this.newDraft(false);
        this.notice = kind === 'draft' ? 'Draft deleted.' : 'Campaign deleted.';
      });
    } finally { this.deletingCampaignId.set(null); }
  }
  private async campaignAction(name: 'prepareMarketingCampaign' | 'cloneMarketingCampaign', label: string, message: string): Promise<void> {
    if (!this.selected) return;
    await this.run(label, async () => (await this.functions.call(name, { id: this.selected!.id })).data as MarketingCampaignView,
      campaign => { this.choose(campaign, false); this.notice = message; });
  }
  async manualRefresh(): Promise<void> {
    if (this.busy || this.loading()) return;
    const result = await this.refresh();
    if (result === 'loaded') this.haptics.success();
    else if (result === 'failed') this.haptics.error();
  }
  async changeCap(): Promise<void> {
    await this.run('Updating limit', async () => (await this.functions.call('setMarketingDailyCap',
      { dailyCap: Number(this.cap) })).data as MarketingCampaignListResponse,
      data => { this.list = data; this.notice = `Global limit is ${data.dailyCap} submissions per UTC day.`; });
  }
}
