import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AdminMarketingComponent } from './admin-marketing.component';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { MarketingCampaignListResponse, MarketingCampaignView } from '../../../../../shared/admin-marketing';

const listing: MarketingCampaignListResponse = { campaigns: [], dailyCap: 10, usedToday: 0, utcDate: '2026-09-23' };
function setup(call = vi.fn(async () => ({ data: listing }))) {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: AppFunctionsService, useValue: { call } },
    { provide: AppHapticsService, useValue: haptics },
  ] });
  return { component: TestBed.runInInjectionContext(() => new AdminMarketingComponent()), haptics, call };
}

describe('AdminMarketingComponent haptics', () => {
  it('offers preparation recovery only after the server lease has expired', () => {
    const { component } = setup();
    component.selected = { status: 'preparing', updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() } as MarketingCampaignView;
    expect(component.canRetryPreparation).toBe(false);
    component.selected = { status: 'preparing', updatedAt: new Date(Date.now() - 12 * 60_000).toISOString() } as MarketingCampaignView;
    expect(component.canRetryPreparation).toBe(true);
    component.selected = { status: 'ready', updatedAt: new Date(Date.now() - 12 * 60_000).toISOString() } as MarketingCampaignView;
    expect(component.canRetryPreparation).toBe(false);
  });
  it('is silent on initialization and unchanged selections', () => {
    const { component, haptics } = setup();
    component.newDraft();
    component.changePreview('desktop');
    expect(haptics.selection).not.toHaveBeenCalled();
    const campaign = { id: 'campaign_1234567890', name: 'First', subject: 'First',
      content: { type: 'doc', content: [] }, cta: null,
      filters: { plans: ['free'], signupFrom: null, signupTo: null }, status: 'draft' } as MarketingCampaignView;
    component.choose(campaign);
    component.choose(campaign);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
  it('reports success only after a mutation resolves', async () => {
    const { component, haptics, call } = setup();
    component.cap = 12;
    await component.changeCap();
    expect(call).toHaveBeenCalledWith('setMarketingDailyCap', { dailyCap: 12 });
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(haptics.error).not.toHaveBeenCalled();
  });
  it('reports a failed mutation as an error', async () => {
    const { component, haptics } = setup(vi.fn(async () => { throw new Error('request failed'); }));
    component.cap = 12;
    await component.changeCap();
    expect(component.error).toContain('request failed');
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
  });
  it('sends the saved campaign test to the entered recipient', async () => {
    const { component, call } = setup();
    component.selected = { id: 'campaign_1234567890', status: 'draft' } as MarketingCampaignView;
    component.testTo = ' qa@example.org ';
    await component.sendTest();
    expect(call).toHaveBeenCalledWith('sendMarketingTest', { id: 'campaign_1234567890', to: 'qa@example.org' });
    expect(component.notice).toContain('qa@example.org');
  });
  it('sends the unsaved composer without creating a campaign', async () => {
    const { component, call } = setup();
    component.draft.subject = 'Test subject';
    component.draft.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A test message' }] }] };
    component.testTo = ' jimmykane9@gmail.com ';
    expect(component.canSendTest).toBe(true);
    await component.sendTest();
    expect(call).toHaveBeenCalledWith('sendMarketingTest', { id: null, to: 'jimmykane9@gmail.com',
      draft: expect.objectContaining({ name: 'Test message', subject: 'Test subject' }) });
    expect(call).not.toHaveBeenCalledWith('saveMarketingCampaign', expect.anything());
    expect(component.notice).toContain('Check that inbox');
  });
  it('shows the test recipient field before a campaign is saved', () => {
    setup();
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="email"]')).not.toBeNull();
    fixture.destroy();
  });
  it('renders a live server preview from an unsaved message without sending mail', async () => {
    const preview = { subject: 'Subject', html: '<p>Hello</p>', text: 'Hello' };
    const call = vi.fn(async (name: string) => ({ data: name === 'previewMarketingCampaign' ? preview : listing }));
    const { component, haptics } = setup(call);
    component.draft.subject = 'Subject';
    component.draft.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
    vi.useFakeTimers();
    try {
      component.schedulePreview();
      await vi.advanceTimersByTimeAsync(900);
      expect(component.preview).toEqual(preview);
      expect(call).toHaveBeenCalledWith('previewMarketingCampaign', { draft: expect.objectContaining({ name: 'Preview', subject: 'Subject' }) });
      expect(haptics.success).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); component.ngOnDestroy(); }
  });
  it('keeps the email template CSS in a sandboxed preview beside a saved draft', async () => {
    const html = '<!doctype html><html><head><style>body{color:#123456}</style></head><body style="margin:0"><p>Hello</p></body></html>';
    const call = vi.fn(async (name: string) => ({ data: name === 'previewMarketingCampaign'
      ? { subject: 'A note', html, text: 'Hello' } : listing }));
    setup(call);
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.componentInstance.selected = { id: 'campaign_1234567890', name: 'Product update', status: 'draft',
      stats: { eligible: 0, pending: 0, queued: 0, accepted: 0, failed: 0, skipped: 0 } } as MarketingCampaignView;
    fixture.componentInstance.draft.subject = 'A note';
    fixture.componentInstance.draft.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
    vi.useFakeTimers();
    try {
      fixture.detectChanges();
      fixture.componentInstance.schedulePreview();
      await vi.advanceTimersByTimeAsync(900);
      fixture.detectChanges();
      const frame = fixture.nativeElement.querySelector('iframe');
      expect(frame?.getAttribute('srcdoc')).toContain('<style>body{color:#123456}</style>');
      expect(frame?.getAttribute('srcdoc')).toContain('style="margin:0"');
      expect(frame?.getAttribute('sandbox')).toBe('');
      expect(fixture.nativeElement.querySelector('input[type="email"]')).not.toBeNull();
    } finally { fixture.destroy(); vi.useRealTimers(); }
  });
});
