import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import type { MarketingCampaignDraft, MarketingCampaignListResponse, MarketingCampaignView, MarketingDocument, MarketingPlan } from '../../../../../shared/admin-marketing';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MarketingRichEditorComponent } from './marketing-rich-editor.component';
import { hasVisibleMarketingText } from './marketing-editor';

function emptyDraft(): MarketingCampaignDraft {
  return { name: '', subject: '', content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
    cta: null, filters: { plans: ['free', 'basic', 'pro'], signupFrom: null, signupTo: null } };
}

@Component({
  selector: 'app-admin-marketing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule, MatCardModule, MatCheckboxModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatButtonToggleModule,
    MatSlideToggleModule, MarketingRichEditorComponent, PageHeaderComponent],
  templateUrl: './admin-marketing.component.html',
  styleUrls: ['./admin-marketing.component.scss'],
})
export class AdminMarketingComponent implements OnInit, OnDestroy {
  private readonly functions = inject(AppFunctionsService);
  private readonly haptics = inject(AppHapticsService);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewSequence = 0;
  private destroyed = false;
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
  error = '';
  notice = '';
  preview: { subject: string; html: string; text: string } | null = null;
  previewBusy = false;
  previewError = '';
  activePreview: 'desktop' | 'phone' | 'text' = 'desktop';
  readonly plans: MarketingPlan[] = ['free', 'basic', 'pro'];

  ngOnInit(): void { void this.refresh(); }
  ngOnDestroy(): void { this.destroyed = true; this.clearPreviewTimer(); this.previewSequence++; }
  changePreview(view: 'desktop' | 'phone' | 'text'): void {
    if (this.activePreview === view) return;
    this.activePreview = view;
    this.haptics.selection();
  }

  get canEdit(): boolean { return !this.selected || this.selected.status === 'draft'; }
  get canRetryPreparation(): boolean {
    if (this.selected?.status !== 'preparing') return false;
    const started = Date.parse(this.selected.updatedAt);
    return !Number.isFinite(started) || Date.now() - started >= 11 * 60_000;
  }
  get remaining(): number { return this.list ? Math.max(0, this.list.dailyCap - this.list.usedToday) : 0; }
  get counts() { return this.selected?.stats; }
  get exclusions() { return this.selected?.exclusions; }

  async refresh(): Promise<void> {
    try {
      const result = await this.functions.call<undefined, MarketingCampaignListResponse>('listMarketingCampaigns');
      this.list = result.data;
      this.error = '';
      this.cap = result.data.dailyCap;
      if (this.selected) {
        const fresh = result.data.campaigns.find(item => item.id === this.selected?.id);
        if (fresh) this.selected = fresh;
      }
    } catch (error) { this.error = this.message(error); }
  }
  choose(campaign: MarketingCampaignView, feedback = true): void {
    if (feedback && this.selected?.id !== campaign.id) this.haptics.selection();
    this.selected = campaign;
    this.draft = { name: campaign.name, subject: campaign.subject, content: campaign.content,
      cta: campaign.cta, filters: { ...campaign.filters, plans: [...campaign.filters.plans] } };
    this.dirty = false;
    this.showCta = !!campaign.cta;
    this.ctaLabel = campaign.cta?.label || '';
    this.ctaUrl = campaign.cta?.url || '';
    this.testTo = feedback ? campaign.lastTestTo || '' : this.testTo || campaign.lastTestTo || '';
    this.resetPreview();
    this.schedulePreview();
    this.error = '';
    this.notice = '';
  }
  newDraft(): void {
    if (this.selected || this.draft.name || this.draft.subject) this.haptics.selection();
    this.selected = null;
    this.draft = emptyDraft();
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
    if (this.draft.filters.plans.includes(plan) === checked) return;
    this.haptics.selection();
    this.draft.filters.plans = checked
      ? [...new Set([...this.draft.filters.plans, plan])]
      : this.draft.filters.plans.filter(item => item !== plan);
    this.markDirty();
  }
  markDirty(): void { this.dirty = true; this.schedulePreview(); }
  onContentChange(content: MarketingDocument): void {
    this.draft.content = content;
    this.markDirty();
  }
  setCta(enabled: boolean): void {
    if (this.showCta === enabled) return;
    this.showCta = enabled;
    this.haptics.selection();
    this.markDirty();
  }
  private collectDraft(): MarketingCampaignDraft {
    return { name: this.draft.name, subject: this.draft.subject,
      content: this.draft.content,
      cta: this.showCta ? { label: this.ctaLabel, url: this.ctaUrl } : null,
      filters: { plans: [...this.draft.filters.plans], signupFrom: this.draft.filters.signupFrom || null,
        signupTo: this.draft.filters.signupTo || null } };
  }
  private message(error: unknown): string {
    const candidate = error as { message?: string };
    return candidate?.message || 'The request failed. Please try again.';
  }
  private async run<T>(label: string, request: () => Promise<T>, success: (result: T) => void): Promise<void> {
    if (this.busy) return;
    this.busy = label; this.error = ''; this.notice = '';
    try { success(await request()); await this.refresh(); this.haptics.success(); }
    catch (error) { this.error = this.message(error); this.haptics.error(); }
    finally { this.busy = ''; }
  }
  async save(): Promise<void> {
    await this.run('Saving', async () => (await this.functions.call('saveMarketingCampaign',
      { id: this.selected?.id || null, draft: this.collectDraft() })).data as MarketingCampaignView,
      campaign => { this.choose(campaign, false); this.notice = 'Draft saved.'; });
  }
  private clearPreviewTimer(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }
  private resetPreview(): void {
    this.clearPreviewTimer();
    this.previewSequence++;
    this.preview = null;
    this.previewError = '';
    this.previewBusy = false;
  }
  schedulePreview(): void {
    this.clearPreviewTimer();
    const sequence = ++this.previewSequence;
    if (!this.draft.subject.trim() || !hasVisibleMarketingText(this.draft.content)) {
      this.preview = null;
      this.previewError = '';
      this.previewBusy = false;
      return;
    }
    this.previewBusy = true;
    this.previewTimer = setTimeout(() => { void this.renderPreview(sequence); }, 900);
  }
  private async renderPreview(sequence: number): Promise<void> {
    const draft = this.collectDraft();
    const previewDraft = { ...draft, name: draft.name.trim() || 'Preview',
      filters: { plans: draft.filters.plans.length ? draft.filters.plans : this.plans,
        signupFrom: null, signupTo: null } };
    this.previewBusy = true;
    try {
      const result = await this.functions.call<unknown, { subject: string; html: string; text: string }>(
        'previewMarketingCampaign', { draft: previewDraft });
      if (this.destroyed || sequence !== this.previewSequence) return;
      this.preview = result.data;
      this.previewError = '';
    } catch (error) {
      if (this.destroyed || sequence !== this.previewSequence) return;
      this.preview = null;
      this.previewError = this.message(error);
    } finally {
      if (sequence === this.previewSequence) this.previewBusy = false;
    }
  }
  async prepare(): Promise<void> { await this.campaignAction('prepareMarketingCampaign', 'Preparing audience', 'Audience frozen. Review counts, then send a test.'); }
  async sendTest(): Promise<void> {
    if (!this.selected) return;
    const to = this.testTo.trim();
    await this.run('Sending test', async () => (await this.functions.call('sendMarketingTest', { id: this.selected!.id, to })).data,
      () => { this.notice = `Test submitted to ${to}. Refresh until SMTP acceptance appears.`; });
  }
  async change(action: 'start' | 'pause' | 'resume' | 'retry'): Promise<void> {
    if (!this.selected) return;
    await this.run(action, async () => (await this.functions.call('changeMarketingCampaignStatus',
      { id: this.selected!.id, action })).data as MarketingCampaignView,
      campaign => { this.selected = campaign; this.notice = `Campaign ${action} request completed.`; });
  }
  async clone(): Promise<void> { await this.campaignAction('cloneMarketingCampaign', 'Cloning', 'Campaign copied as a new draft.'); }
  private async campaignAction(name: 'prepareMarketingCampaign' | 'cloneMarketingCampaign', label: string, message: string): Promise<void> {
    if (!this.selected) return;
    await this.run(label, async () => (await this.functions.call(name, { id: this.selected!.id })).data as MarketingCampaignView,
      campaign => { this.choose(campaign, false); this.notice = message; });
  }
  async manualRefresh(): Promise<void> {
    await this.refresh();
    if (!this.error) this.haptics.success(); else this.haptics.error();
  }
  async changeCap(): Promise<void> {
    await this.run('Updating limit', async () => (await this.functions.call('setMarketingDailyCap',
      { dailyCap: Number(this.cap) })).data as MarketingCampaignListResponse,
      data => { this.list = data; this.notice = `Global limit is ${data.dailyCap} submissions per UTC day.`; });
  }
}
