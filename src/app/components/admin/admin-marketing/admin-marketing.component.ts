import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
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
import { documentFromEditor, fillEditor } from './marketing-editor';
import type { MarketingCampaignDraft, MarketingCampaignListResponse, MarketingCampaignView, MarketingPlan } from '../../../../../shared/admin-marketing';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

function emptyDraft(): MarketingCampaignDraft {
  return { name: '', subject: '', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] },
    cta: null, filters: { plans: ['free', 'basic', 'pro'], signupFrom: null, signupTo: null } };
}

@Component({
  selector: 'app-admin-marketing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule, MatCardModule, MatCheckboxModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatButtonToggleModule, PageHeaderComponent],
  templateUrl: './admin-marketing.component.html',
  styleUrls: ['./admin-marketing.component.scss'],
})
export class AdminMarketingComponent implements OnInit {
  private readonly functions = inject(AppFunctionsService);
  private readonly haptics = inject(AppHapticsService);
  private savedRange: Range | null = null;
  @ViewChild('editorHost') editorHost?: ElementRef<HTMLElement>;
  list: MarketingCampaignListResponse | null = null;
  selected: MarketingCampaignView | null = null;
  draft = emptyDraft();
  linkUrl = '';
  ctaLabel = '';
  ctaUrl = '';
  cap = 10;
  busy = '';
  error = '';
  notice = '';
  preview: { subject: string; html: string; text: string } | null = null;
  activePreview: 'desktop' | 'phone' | 'text' = 'desktop';
  readonly plans: MarketingPlan[] = ['free', 'basic', 'pro'];

  ngOnInit(): void { void this.refresh(); }
  rememberSelection(): void {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (range && this.editorHost?.nativeElement.contains(range.commonAncestorContainer)) this.savedRange = range.cloneRange();
  }
  private restoreSelection(): void {
    if (!this.savedRange) return;
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(this.savedRange);
  }
  format(command: string, value?: string): void {
    if (!this.canEdit || !this.editorHost) return;
    this.editorHost.nativeElement.focus();
    this.restoreSelection();
    if (document.execCommand(command, false, value)) this.haptics.selection();
    this.rememberSelection();
  }
  heading(): void { this.format('formatBlock', 'h2'); }
  changePreview(view: 'desktop' | 'phone' | 'text'): void {
    if (this.activePreview === view) return;
    this.activePreview = view;
    this.haptics.selection();
  }

  get canEdit(): boolean { return !this.selected || this.selected.status === 'draft'; }
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
    this.savedRange = null;
    this.draft = { name: campaign.name, subject: campaign.subject, content: campaign.content,
      cta: campaign.cta, filters: { ...campaign.filters, plans: [...campaign.filters.plans] } };
    this.ctaLabel = campaign.cta?.label || '';
    this.ctaUrl = campaign.cta?.url || '';
    if (this.editorHost) fillEditor(this.editorHost.nativeElement, campaign.content);
    this.preview = null;
    this.error = '';
    this.notice = '';
  }
  newDraft(): void {
    if (this.selected || this.draft.name || this.draft.subject) this.haptics.selection();
    this.selected = null;
    this.savedRange = null;
    this.draft = emptyDraft();
    this.ctaLabel = '';
    this.ctaUrl = '';
    if (this.editorHost) fillEditor(this.editorHost.nativeElement, this.draft.content);
    this.preview = null;
    this.error = '';
    this.notice = '';
  }
  togglePlan(plan: MarketingPlan, checked: boolean): void {
    if (this.draft.filters.plans.includes(plan) === checked) return;
    this.haptics.selection();
    this.draft.filters.plans = checked
      ? [...new Set([...this.draft.filters.plans, plan])]
      : this.draft.filters.plans.filter(item => item !== plan);
  }
  applyLink(): void {
    if (!this.linkUrl) return;
    try {
      const parsed = new URL(this.linkUrl);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') || parsed.username || parsed.password) throw new Error();
    } catch { this.error = 'Enter an HTTPS or mailto link.'; this.haptics.error(); return; }
    this.format('createLink', this.linkUrl);
    this.linkUrl = '';
  }
  removeLink(): void { this.format('unlink'); }
  private collectDraft(): MarketingCampaignDraft {
    return { name: this.draft.name, subject: this.draft.subject,
      content: this.editorHost ? documentFromEditor(this.editorHost.nativeElement) : this.draft.content,
      cta: this.ctaLabel.trim() || this.ctaUrl.trim() ? { label: this.ctaLabel, url: this.ctaUrl } : null,
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
  async showPreview(): Promise<void> {
    await this.run('Rendering preview', async () => (await this.functions.call('previewMarketingCampaign',
      { draft: this.collectDraft() })).data as { subject: string; html: string; text: string },
      preview => { this.preview = preview; this.notice = 'Preview rendered with the email template.'; });
  }
  async prepare(): Promise<void> { await this.campaignAction('prepareMarketingCampaign', 'Preparing audience', 'Audience frozen. Review counts, then send a test.'); }
  async sendTest(): Promise<void> {
    if (!this.selected) return;
    await this.run('Sending test', async () => (await this.functions.call('sendMarketingTest', { id: this.selected!.id })).data,
      () => { this.notice = 'Test submitted to your admin email. Refresh until SMTP acceptance appears.'; });
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
