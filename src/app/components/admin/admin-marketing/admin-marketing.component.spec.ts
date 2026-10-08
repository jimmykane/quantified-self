import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AdminMarketingComponent } from './admin-marketing.component';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import type { MarketingCampaignListResponse, MarketingCampaignView } from '../../../../../shared/admin-marketing';

const listing: MarketingCampaignListResponse = { campaigns: [], dailyCap: 10, usedToday: 0, utcDate: '2026-09-23' };
const pausedCampaign: MarketingCampaignView = {
  id: 'campaign_1234567890', name: 'Product update', subject: 'Original subject',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original message' }] }] },
  cta: { label: 'Open app', url: 'https://quantified-self.io/dashboard' },
  filters: { plans: ['free'], signupFrom: '2026-09-01', signupTo: null }, status: 'paused',
  stats: { eligible: 10, pending: 6, queued: 1, accepted: 2, failed: 0, skipped: 1 },
  exclusions: { noAuth: 0, disabledOrAdmin: 0, noEmail: 0, noProfile: 0, deletionMarked: 0, plan: 1, signupDate: 0 },
  createdAt: '2026-09-23T10:00:00Z', updatedAt: '2026-09-23T10:00:00Z', startedAt: '2026-09-23T10:00:00Z',
  lastTestMailId: 'previous-test', lastTestState: 'SUCCESS', lastTestTo: 'qa@example.org',
};
const readyCampaign: MarketingCampaignView = { ...pausedCampaign, status: 'ready', startedAt: null,
  stats: { eligible: 10, pending: 10, queued: 0, accepted: 0, failed: 0, skipped: 0 } };
function setup(call = vi.fn(async () => ({ data: listing }))) {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const dialog = { open: vi.fn(() => ({ afterClosed: () => of(false), close: vi.fn() })) };
  TestBed.configureTestingModule({ providers: [
    { provide: AppFunctionsService, useValue: { call } },
    { provide: AppHapticsService, useValue: haptics },
    { provide: MatDialog, useValue: dialog },
  ] });
  TestBed.overrideComponent(AdminMarketingComponent, { add: { providers: [{ provide: MatDialog, useValue: dialog }] } });
  return { component: TestBed.runInInjectionContext(() => new AdminMarketingComponent()), haptics, call, dialog };
}

describe('AdminMarketingComponent', () => {
  it('defaults legacy campaigns, loads custom senders, and locks sender editing for frozen campaigns', async () => {
    setup();
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const component = fixture.componentInstance;
    const input = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#campaign-sender-name')!;
    expect(input().value).toBe('Dimitrios from Quantified Self');
    expect(input().maxLength).toBe(120);
    component.choose(pausedCampaign, false); fixture.detectChanges();
    expect(component.draft.senderName).toBe('Dimitrios from Quantified Self');
    component.choose({ ...pausedCampaign, senderName: 'Dimitrios' }, false);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(input().value).toBe('Dimitrios');
    expect(input().disabled).toBe(false);
    input().value = 'Élodie from QS'; input().dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(component.draft.senderName).toBe('Élodie from QS');
    expect(component.dirty).toBe(true);
    expect(component.canResume).toBe(false);
    component.choose({ ...readyCampaign, senderName: 'Dimitrios' }, false); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(input().disabled).toBe(true);
    component.choose({ ...pausedCampaign, status: 'running', senderName: 'Dimitrios' }, false); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(input().disabled).toBe(true);
    fixture.destroy();
  });

  it('requires a sender name before previewing, saving or testing', async () => {
    const { component, call } = setup();
    component.choose(pausedCampaign, false);
    component.draft.senderName = '   ';
    component.markDirty();
    expect(component.previewError).toBe('Enter a sender name.');
    expect(component.canSendTest).toBe(false);
    await component.save();
    expect(call).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('refreshes sender-only saved changes while preserving an unsaved sender and test recipient', async () => {
    const updated = { ...pausedCampaign, senderName: 'Dimitrios' };
    const { component } = setup(vi.fn(async () => ({ data: { ...listing, campaigns: [updated] } })));
    component.choose(pausedCampaign, false);
    component.testTo = 'qa@example.org';
    await component.refresh();
    expect(component.draft.senderName).toBe('Dimitrios');
    expect(component.testTo).toBe('qa@example.org');
    expect(component.dirty).toBe(false);
    component.draft.senderName = 'My unsaved name'; component.markDirty();
    await component.refresh();
    expect(component.draft.senderName).toBe('My unsaved name');
    expect(component.canResume).toBe(false);
    component.ngOnDestroy();
  });

  it('confirms deletion of a prepared campaign including its recipient list without starting it', async () => {
    const call = vi.fn(async (name: string) => ({ data: name === 'changeMarketingCampaignStatus'
      ? { id: readyCampaign.id, deleted: true } : listing }));
    const { component, haptics, dialog } = setup(call);
    component.loading.set(false);
    component.list = { ...listing, campaigns: [readyCampaign] };
    component.choose(readyCampaign, false);
    expect(component.canDelete).toBe(true);
    dialog.open.mockReturnValue({ afterClosed: () => of(true), close: vi.fn() });
    await component.deleteCampaign();
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({
      title: 'Delete campaign?', confirmText: 'Delete campaign',
      message: expect.stringContaining('Any prepared recipient list is also removed.'),
    }) }));
    expect(call).toHaveBeenCalledWith('changeMarketingCampaignStatus', { id: readyCampaign.id, action: 'delete' });
    expect(component.selected).toBeNull();
    expect(component.list?.campaigns).toEqual([]);
    expect(component.notice).toBe('Campaign deleted.');
    expect(haptics.success).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });

  it('hides deletion for an inconsistent ready campaign that already started', async () => {
    const { component, dialog } = setup();
    component.loading.set(false);
    component.choose({ ...readyCampaign, startedAt: pausedCampaign.startedAt }, false);
    expect(component.canDelete).toBe(false);
    await component.deleteCampaign();
    expect(dialog.open).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('confirms draft deletion, shows progress, removes the draft and resets unsaved edits', async () => {
    const campaign = { ...pausedCampaign, status: 'draft' as const };
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const call = vi.fn(async (name: string) => name === 'changeMarketingCampaignStatus'
      ? (await pending, { data: { id: campaign.id, deleted: true } }) : { data: listing });
    const { component, haptics, dialog } = setup(call);
    component.loading.set(false);
    component.list = { ...listing, campaigns: [campaign] };
    component.choose(campaign, false);
    component.draft.subject = 'Unsaved changes'; component.dirty = true;
    dialog.open.mockReturnValue({ afterClosed: () => of(true), close: vi.fn() });
    const deletion = component.deleteCampaign();
    await Promise.resolve();
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({
      title: 'Delete draft?', message: expect.stringContaining(campaign.name), confirmColor: 'warn',
    }) }));
    expect(component.busy).toBe('Deleting campaign');
    expect(call).toHaveBeenCalledWith('changeMarketingCampaignStatus', { id: campaign.id, action: 'delete' });
    expect(haptics.success).not.toHaveBeenCalled();
    release(); await deletion;
    expect(component.selected).toBeNull();
    expect(component.draft.subject).toBe('');
    expect(component.dirty).toBe(false);
    expect(component.preview).toBeNull();
    expect(component.list?.campaigns).toEqual([]);
    expect(component.notice).toBe('Draft deleted.');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    expect(haptics.success).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });

  it('preserves the draft when confirmation is cancelled or the delete fails', async () => {
    const { component, call, dialog, haptics } = setup();
    component.loading.set(false);
    component.choose({ ...pausedCampaign, status: 'draft' }, false);
    component.draft.subject = 'Unsaved edits'; component.dirty = true;
    await component.deleteCampaign();
    expect(call).not.toHaveBeenCalled();
    expect(component.draft.subject).toBe('Unsaved edits');
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    dialog.open.mockReturnValue({ afterClosed: () => of(true), close: vi.fn() });
    call.mockRejectedValueOnce(new Error('Only drafts and prepared campaigns that have not started can be deleted.'));
    await component.deleteCampaign();
    expect(component.selected?.id).toBe(pausedCampaign.id);
    expect(component.draft.subject).toBe('Unsaved edits');
    expect(component.error).toContain('have not started');
    expect(component.busy).toBe('');
    expect(haptics.error).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });

  it('ignores duplicate confirmation, changed selection and confirmation after navigation', async () => {
    const { component, call, dialog, haptics } = setup();
    const closed = new Subject<boolean>();
    const close = vi.fn((value: boolean) => closed.next(value));
    dialog.open.mockReturnValue({ afterClosed: () => closed, close });
    component.loading.set(false);
    component.choose({ ...pausedCampaign, status: 'draft' }, false);
    const deletion = component.deleteCampaign();
    await component.deleteCampaign();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    component.newDraft(false);
    closed.next(true); await deletion;
    expect(call).not.toHaveBeenCalled();
    component.choose({ ...pausedCampaign, status: 'draft' }, false);
    const afterNavigation = component.deleteCampaign();
    component.ngOnDestroy();
    await afterNavigation;
    expect(close).toHaveBeenCalledWith(false);
    expect(call).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'running', 'paused', 'completed'] as const)('does not offer deletion for %s campaigns', async status => {
    const { component, dialog, haptics } = setup();
    component.loading.set(false);
    component.choose({ ...pausedCampaign, status }, false);
    expect(component.canDelete).toBe(false);
    await component.deleteCampaign();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('renders deletion beside a saved draft, keeps its progress control stable and offers cleanup retry', async () => {
    const { dialog } = setup();
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const component = fixture.componentInstance;
    const header = () => (fixture.nativeElement as HTMLElement).querySelector('.campaign-header');
    expect(header()?.querySelector('button')).toBeNull();
    component.choose({ ...pausedCampaign, status: 'draft' }, false);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    let button = header()?.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Delete draft');
    component.busy = 'Deleting campaign'; component.deletingCampaignId.set(pausedCampaign.id); fixture.detectChanges();
    expect(header()?.querySelector('button')).toBe(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Deleting…');
    expect(button.querySelector('.refresh-button-icon mat-spinner')).not.toBeNull();
    component.busy = ''; component.deletingCampaignId.set(null); component.loading.set(true); fixture.detectChanges();
    expect(button.disabled).toBe(true);
    await component.deleteCampaign();
    expect(dialog.open).not.toHaveBeenCalled();
    component.loading.set(false);
    component.choose({ ...pausedCampaign, status: 'deleting' }, false); fixture.detectChanges();
    button = header()?.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Retry deletion');
    expect(component.canEdit).toBe(false);
    expect(component.canSendTest).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Clone');
    component.choose(pausedCampaign, false); fixture.detectChanges();
    expect(header()?.querySelector('button')).toBeNull();
    fixture.destroy();
  });

  it('deletes a draft from the list without selecting it or discarding the current unsaved composer', async () => {
    const target = { ...pausedCampaign, status: 'draft' as const };
    const call = vi.fn(async (name: string) => ({ data: name === 'changeMarketingCampaignStatus' ? { id: target.id, deleted: true } : listing }));
    const { component, dialog, haptics } = setup(call);
    component.loading.set(false);
    component.list = { ...listing, campaigns: [target] };
    component.draft.subject = 'Keep this unsaved message'; component.dirty = true;
    dialog.open.mockReturnValue({ afterClosed: () => of(true), close: vi.fn() });
    await component.deleteCampaign(target);
    expect(call).toHaveBeenCalledWith('changeMarketingCampaignStatus', { id: target.id, action: 'delete' });
    expect(component.selected).toBeNull();
    expect(component.draft.subject).toBe('Keep this unsaved message');
    expect(component.dirty).toBe(true);
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(dialog.open.mock.calls[0][1].data.message).not.toContain('discards unsaved edits');
    component.ngOnDestroy();
  });

  it('shows deletion in the list and header for a prepared campaign before Start', async () => {
    const target = { ...pausedCampaign, status: 'draft' as const };
    const ready = { ...readyCampaign, id: 'ready_campaign_1234' };
    const { dialog, call } = setup(vi.fn(async () => ({ data: { ...listing, campaigns: [target, ready] } })));
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    fixture.componentInstance.choose(ready, false); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll('.campaign-list-item');
    const deletion = rows[0].querySelector('button[aria-label]') as HTMLButtonElement;
    expect(deletion.getAttribute('aria-label')).toBe(`Delete draft: ${target.name}`);
    expect(deletion.closest('.campaign-row')).toBeNull();
    expect(rows[1].querySelector('button[aria-label]')?.getAttribute('aria-label')).toBe(`Delete campaign: ${ready.name}`);
    expect(root.querySelector('.campaign-header button')?.textContent).toContain('Delete campaign');
    deletion.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.selected?.id).toBe(ready.id);
    expect(call).not.toHaveBeenCalledWith('changeMarketingCampaignStatus', expect.anything());
    fixture.destroy();
  });

  it('refreshes a partially deleted draft to expose retry without losing unsaved text or its failure', async () => {
    const locked = { ...pausedCampaign, status: 'deleting' as const };
    const call = vi.fn(async (name: string) => {
      if (name === 'changeMarketingCampaignStatus') throw new Error('Cleanup unavailable');
      return { data: { ...listing, campaigns: [locked] } };
    });
    const { component, dialog, haptics } = setup(call);
    component.loading.set(false);
    component.choose({ ...pausedCampaign, status: 'draft' }, false);
    component.draft.subject = 'Keep until cleanup succeeds'; component.dirty = true;
    dialog.open.mockReturnValue({ afterClosed: () => of(true), close: vi.fn() });
    await component.deleteCampaign();
    expect(component.selected?.status).toBe('deleting');
    expect(component.canEdit).toBe(false);
    expect(component.canDelete).toBe(true);
    expect(component.draft.subject).toBe('Keep until cleanup succeeds');
    expect(component.error).toBe('Cleanup unavailable');
    expect(component.deletingCampaignId()).toBeNull();
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('does not delete a prepared campaign that started while confirmation was open', async () => {
    const target = readyCampaign;
    const { component, call, dialog } = setup();
    const closed = new Subject<boolean>();
    component.loading.set(false); component.list = { ...listing, campaigns: [target] };
    dialog.open.mockReturnValue({ afterClosed: () => closed, close: vi.fn() });
    const deletion = component.deleteCampaign(target);
    component.list = { ...listing, campaigns: [{ ...target, status: 'running', startedAt: '2026-10-06T09:00:00Z' }] };
    closed.next(true); await deletion;
    expect(call).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('does not refresh or give feedback after a pending deletion finishes following navigation', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const call = vi.fn(async () => { await pending; return { data: { deleted: true } }; });
    const { component, dialog, haptics } = setup(call);
    component.loading.set(false);
    component.choose({ ...pausedCampaign, status: 'draft' }, false);
    dialog.open.mockReturnValue({ afterClosed: () => of(true), close: vi.fn() });
    const deletion = component.deleteCampaign(); await Promise.resolve();
    component.ngOnDestroy(); release(); await deletion;
    expect(call).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
  });

  it('shows initial loading instead of an empty workspace or a default limit until the list arrives', async () => {
    let release!: (value: { data: MarketingCampaignListResponse }) => void;
    const pending = new Promise<{ data: MarketingCampaignListResponse }>(resolve => { release = resolve; });
    const { call, haptics } = setup(vi.fn(() => pending));
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.initial-loading')?.textContent).toContain('Loading campaigns');
    expect(root.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector('.workspace')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    expect(call).toHaveBeenCalledWith('listMarketingCampaigns');
    release({ data: { ...listing, dailyCap: 37, campaigns: [pausedCampaign] } });
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.initial-loading')).toBeNull();
    expect(root.querySelector('main')?.getAttribute('aria-busy')).toBe('false');
    expect(root.querySelector('.campaign-row')?.textContent).toContain(pausedCampaign.name);
    expect(root.querySelector<HTMLInputElement>('.limit-card input')?.value).toBe('37');
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('shows an initial failure with a working retry and distinguishes a loaded empty campaign list', async () => {
    let reject!: (error: Error) => void;
    let releaseRetry!: (value: { data: MarketingCampaignListResponse }) => void;
    const first = new Promise<never>((_resolve, fail) => { reject = fail; });
    const retry = new Promise<{ data: MarketingCampaignListResponse }>(resolve => { releaseRetry = resolve; });
    const call = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(retry);
    const { haptics } = setup(call);
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.detectChanges();
    reject(new Error('Unable to load campaigns'));
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Unable to load campaigns');
    expect(root.querySelector('.initial-loading')).toBeNull();
    expect(root.querySelector('.workspace')).toBeNull();
    expect(haptics.error).not.toHaveBeenCalled();
    const manualRefresh = vi.spyOn(fixture.componentInstance, 'manualRefresh');
    root.querySelector<HTMLButtonElement>('.initial-load-error button')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.initial-loading')).not.toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
    releaseRetry({ data: listing });
    await manualRefresh.mock.results[0].value;
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.campaign-empty')?.textContent).toContain('No campaigns yet');
    expect(root.querySelector('.workspace')).not.toBeNull();
    expect(root.querySelector('.initial-load-error')).toBeNull();
    expect(haptics.success).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
  it('keeps the editor and unsaved text in place while refreshing and disables duplicate refreshes', async () => {
    let release!: (value: { data: MarketingCampaignListResponse }) => void;
    const pending = new Promise<{ data: MarketingCampaignListResponse }>(resolve => { release = resolve; });
    let lists = 0;
    const call = vi.fn((name: string) => {
      if (name === 'listMarketingCampaigns') return ++lists === 1
        ? Promise.resolve({ data: { ...listing, campaigns: [pausedCampaign] } }) : pending;
      return Promise.resolve({ data: { from: 'Dimitrios from Quantified Self <updates@quantified-self.io>', replyTo: 'Dimitrios <dimitrios@quantified-self.io>', subject: pausedCampaign.subject, html: '<p>Preview</p>', text: 'Preview' } });
    });
    const { haptics } = setup(call);
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    const component = fixture.componentInstance;
    component.choose(pausedCampaign, false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    component.draft.subject = 'My unsaved subject';
    component.dirty = true;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const editor = root.querySelector('app-marketing-rich-editor');
    const refresh = component.refresh();
    fixture.detectChanges();
    expect(root.querySelector('.refresh-status')?.textContent).toContain('Refreshing campaigns');
    expect(root.querySelector('app-marketing-rich-editor')).toBe(editor);
    expect(root.querySelector<HTMLInputElement>('input[maxlength="180"]')?.value).toBe('My unsaved subject');
    const refreshButton = root.querySelector<HTMLButtonElement>('button[aria-label="Refresh status"]');
    expect(refreshButton?.disabled).toBe(true);
    expect(refreshButton?.textContent).toContain('Refreshing');
    expect(refreshButton?.querySelector('mat-spinner')).not.toBeNull();
    await component.manualRefresh();
    expect(lists).toBe(2);
    release({ data: { ...listing, campaigns: [{ ...pausedCampaign, stats: { ...pausedCampaign.stats, accepted: 3 } }] } });
    await refresh;
    fixture.detectChanges();
    expect(root.querySelector('.refresh-status')).toBeNull();
    expect(root.querySelector('app-marketing-rich-editor')).toBe(editor);
    expect(component.draft.subject).toBe('My unsaved subject');
    expect(component.counts?.accepted).toBe(3);
    expect(haptics.success).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('keeps loading active when an older response arrives while the latest refresh is pending', async () => {
    let releaseOld!: (value: { data: MarketingCampaignListResponse }) => void;
    let releaseLatest!: (value: { data: MarketingCampaignListResponse }) => void;
    const old = new Promise<{ data: MarketingCampaignListResponse }>(resolve => { releaseOld = resolve; });
    const latest = new Promise<{ data: MarketingCampaignListResponse }>(resolve => { releaseLatest = resolve; });
    const { component } = setup(vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(latest));
    const olderRefresh = component.refresh();
    const newerRefresh = component.refresh();
    releaseOld({ data: { ...listing, dailyCap: 1 } });
    await olderRefresh;
    expect(component.loading()).toBe(true);
    expect(component.list).toBeNull();
    releaseLatest({ data: { ...listing, dailyCap: 25 } });
    await newerRefresh;
    expect(component.loading()).toBe(false);
    expect(component.cap).toBe(25);
    component.ngOnDestroy();
  });
  it('clears the loading state when a failed mutation invalidates an earlier refresh', async () => {
    let releaseOld!: (value: { data: MarketingCampaignListResponse }) => void;
    const old = new Promise<{ data: MarketingCampaignListResponse }>(resolve => { releaseOld = resolve; });
    const call = vi.fn().mockResolvedValueOnce({ data: listing }).mockReturnValueOnce(old).mockRejectedValueOnce(new Error('Limit update failed'));
    const { component, haptics } = setup(call);
    await component.refresh();
    const refresh = component.manualRefresh();
    expect(component.loading()).toBe(true);
    component.cap = 20;
    await component.changeCap();
    expect(component.loading()).toBe(false);
    expect(component.error).toBe('Limit update failed');
    releaseOld({ data: { ...listing, dailyCap: 1 } });
    await refresh;
    expect(component.loading()).toBe(false);
    expect(component.error).toBe('Limit update failed');
    expect(haptics.error).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });
  it('defaults to immediate sending and gives selection feedback only for accepted schedule changes', () => {
    const { component, haptics } = setup();
    expect(component.scheduleMode).toBe('now');
    component.setScheduleMode('now');
    expect(haptics.selection).not.toHaveBeenCalled();
    component.setScheduleMode('daily');
    expect(component.dirty).toBe(true);
    component.setScheduleTimeZone('Pacific/Auckland');
    component.setScheduleTimeZone('Pacific/Auckland');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    component.busy = 'Saving';
    component.setScheduleMode('now');
    component.setScheduleTimeZone('UTC');
    expect(component.scheduleMode).toBe('daily');
    expect(component.scheduleTimeZone).toBe('Pacific/Auckland');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });
  it('saves daily settings, guards invalid times, and lets unsaved email tests bypass the schedule', async () => {
    const scheduled = { ...pausedCampaign, status: 'draft' as const, schedule: { time: '14:30', timeZone: 'UTC' } };
    const call = vi.fn(async (name: string) => ({ data: name === 'saveMarketingCampaign' ? scheduled : listing }));
    const { component } = setup(call);
    component.draft.subject = 'A note';
    component.setScheduleMode('daily');
    component.scheduleTime = '';
    expect(component.scheduleError).toContain('daily time');
    await component.save();
    expect(call).not.toHaveBeenCalled();
    component.scheduleTime = '14:30';
    component.setScheduleTimeZone('UTC');
    await component.save();
    expect(call).toHaveBeenCalledWith('saveMarketingCampaign', { id: null,
      draft: expect.objectContaining({ schedule: { time: '14:30', timeZone: 'UTC' } }) });
    component.scheduleTime = '';
    component.dirty = true;
    component.testTo = 'qa@example.org';
    await component.sendTest();
    expect(call).toHaveBeenCalledWith('sendMarketingTest', { id: null, to: 'qa@example.org',
      draft: expect.objectContaining({ schedule: null }) });
    component.newDraft();
    expect(component.scheduleMode).toBe('now');
    component.ngOnDestroy();
  });
  it('reloads saved scheduling settings silently, includes them on resume and locks running controls', async () => {
    const campaign = { ...pausedCampaign, schedule: { time: '09:00', timeZone: 'Europe/Helsinki' },
      nextScheduledSendAt: new Date(Date.now() + 86_400_000).toISOString() };
    const call = vi.fn(async (name: string) => ({ data: name === 'changeMarketingCampaignStatus'
      ? { ...campaign, status: 'running' } : listing }));
    const { haptics } = setup(call);
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    const component = fixture.componentInstance;
    component.choose(campaign, false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(component.scheduleMode).toBe('daily');
    expect(component.scheduleTimeZone).toBe('Europe/Helsinki');
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLInputElement>('input[type="time"]')?.disabled).toBe(false);
    await component.change('resume');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(call).toHaveBeenCalledWith('changeMarketingCampaignStatus', { id: campaign.id, action: 'resume',
      draft: expect.objectContaining({ schedule: campaign.schedule }) });
    expect(root.querySelector<HTMLInputElement>('input[type="time"]')?.disabled).toBe(true);
    expect(root.querySelector('mat-select')?.getAttribute('aria-disabled')).toBe('true');
    expect(root.textContent).toContain('Next daily batch:');
    component.selected = { ...component.selected!, nextScheduledSendAt: '2000-01-01T09:00:00.000Z' };
    expect(component.nextDailyBatch).toBeNull();
    component.setScheduleMode('now');
    expect(component.scheduleMode).toBe('daily');
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('ignores an older status response that arrives after saving paused edits', async () => {
    let releaseOldRefresh!: (value: { data: MarketingCampaignListResponse }) => void;
    const oldRefresh = new Promise<{ data: MarketingCampaignListResponse }>(resolve => { releaseOldRefresh = resolve; });
    const edited = { ...pausedCampaign, subject: 'Newly saved message', lastTestMailId: null, lastTestState: null };
    let lists = 0;
    const call = vi.fn((name: string) => {
      if (name === 'listMarketingCampaigns') {
        lists++;
        return lists === 1 ? oldRefresh : Promise.resolve({ data: { ...listing, campaigns: [edited] } });
      }
      return Promise.resolve({ data: edited });
    });
    const { component } = setup(call);
    component.choose(pausedCampaign, false);
    const refresh = component.refresh();
    component.draft.subject = edited.subject;
    component.dirty = true;
    await component.save();
    releaseOldRefresh({ data: { ...listing, campaigns: [pausedCampaign] } });
    await refresh;
    expect(component.draft.subject).toBe(edited.subject);
    expect(component.selected?.subject).toBe(edited.subject);
    expect(component.selected?.lastTestMailId).toBeNull();
    expect(component.canResume).toBe(false);
    component.ngOnDestroy();
  });
  it.each(['my-preview@example.org', ''])('refreshes saved content while preserving the test recipient "%s"', async recipient => {
    const updated = { ...pausedCampaign, subject: 'Saved by another admin',
      content: { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'New saved body' }] }] },
      cta: { label: 'New button', url: 'https://quantified-self.io/help' }, updatedAt: '2026-09-23T11:00:00Z' };
    const { component, haptics } = setup(vi.fn(async () => ({ data: { ...listing, campaigns: [updated] } })));
    component.choose(pausedCampaign, false);
    component.testTo = recipient;
    await component.refresh();
    expect(component.draft.subject).toBe(updated.subject);
    expect(component.draft.content).toEqual(updated.content);
    expect(component.ctaLabel).toBe(updated.cta.label);
    expect(component.ctaUrl).toBe(updated.cta.url);
    expect(component.testTo).toBe(recipient);
    expect(component.dirty).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
  it('preserves unsaved paused edits and a current preview when refreshing delivery status', async () => {
    const { component } = setup(vi.fn(async () => ({ data: { ...listing, campaigns: [
      { ...pausedCampaign, subject: 'Another saved message', stats: { ...pausedCampaign.stats, accepted: 3 } },
    ] } })));
    component.choose(pausedCampaign, false);
    component.draft.subject = 'My unsaved message';
    component.dirty = true;
    component.preview = { from: 'Dimitrios from Quantified Self <updates@quantified-self.io>', replyTo: 'Dimitrios <dimitrios@quantified-self.io>', subject: 'My unsaved message', html: '<p>My preview</p>', text: 'My preview' };
    const preview = component.preview;
    await component.refresh();
    expect(component.draft.subject).toBe('My unsaved message');
    expect(component.preview).toBe(preview);
    expect(component.dirty).toBe(true);
    expect(component.canResume).toBe(false);
    expect(component.counts?.accepted).toBe(3);
    component.ngOnDestroy();
  });
  it('locks the composer during a pending save and restores it on failure without losing edits', async () => {
    let rejectSave!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { rejectSave = reject; });
    const call = vi.fn((name: string) => name === 'saveMarketingCampaign' ? pending : Promise.resolve({ data: listing }));
    const { haptics } = setup(call);
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    const component = fixture.componentInstance;
    component.choose(pausedCampaign, false);
    component.draft.subject = 'My edited subject';
    component.dirty = true;
    fixture.detectChanges();
    await fixture.whenStable();
    const save = component.save();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLInputElement>('input[maxlength="180"]')?.disabled).toBe(true);
    expect(root.querySelector('[aria-label="Campaign email body"]')?.getAttribute('contenteditable')).toBe('false');
    expect(root.querySelector<HTMLInputElement>('input[maxlength="80"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('.test-send input[type="email"]')?.disabled).toBe(true);
    rejectSave(new Error('Save failed'));
    await save;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('input[maxlength="180"]')?.disabled).toBe(false);
    expect(component.draft.subject).toBe('My edited subject');
    expect(component.dirty).toBe(true);
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('unlocks paused content while keeping the audience fixed and resume disabled for unsaved or untested changes', async () => {
    setup();
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    const component = fixture.componentInstance;
    component.choose(pausedCampaign, false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const action = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.actions button'))
      .find(button => button.textContent?.trim() === label)!;
    expect(root.querySelector<HTMLInputElement>('input[maxlength="180"]')?.disabled).toBe(false);
    expect(root.querySelector('[aria-label="Campaign email body"]')?.getAttribute('contenteditable')).toBe('true');
    expect(root.querySelector<HTMLInputElement>('input[maxlength="80"]')?.disabled).toBe(false);
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('.plans input, input[type="date"]')).map(input => input.disabled))
      .toEqual([true, true, true, true, true]);
    expect(root.querySelector('.test-send input[type="email"]')).not.toBeNull();
    expect(action('Save changes').disabled).toBe(true);
    expect(action('Resume').disabled).toBe(false);
    component.markDirty();
    fixture.detectChanges();
    expect(action('Save changes').disabled).toBe(false);
    expect(action('Resume').disabled).toBe(true);
    component.dirty = false;
    component.selected = { ...pausedCampaign, lastTestMailId: null, lastTestState: null };
    fixture.detectChanges();
    expect(action('Resume').disabled).toBe(true);
    expect(root.textContent).toContain('wait for SMTP acceptance');
    fixture.destroy();
  });
  it('saves paused edits to the same campaign and sends its saved test to the chosen address', async () => {
    const edited = { ...pausedCampaign, senderName: 'Dimitrios', lastTestMailId: null, lastTestState: null };
    const call = vi.fn(async (name: string) => ({ data: name === 'saveMarketingCampaign'
      ? edited : name === 'listMarketingCampaigns' ? { ...listing, campaigns: [edited] } : { submitted: true } }));
    const { component, haptics } = setup(call);
    component.choose(pausedCampaign, false);
    component.draft.senderName = edited.senderName;
    component.markDirty();
    await component.change('resume');
    expect(call).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    await component.save();
    expect(call).toHaveBeenCalledWith('saveMarketingCampaign', { id: pausedCampaign.id,
      draft: expect.objectContaining({ subject: edited.subject, senderName: edited.senderName, filters: pausedCampaign.filters }) });
    expect(component.selected?.status).toBe('paused');
    expect(component.dirty).toBe(false);
    expect(component.canResume).toBe(false);
    expect(component.notice).toContain('Send a new test before resuming');
    component.testTo = 'new-preview@example.org';
    await component.sendTest();
    expect(call).toHaveBeenCalledWith('sendMarketingTest', { id: pausedCampaign.id, to: 'new-preview@example.org',
      draft: expect.objectContaining({ subject: edited.subject, senderName: edited.senderName, filters: pausedCampaign.filters }) });
    expect(haptics.success).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });
  it('ignores disabled audience changes and resumes an unchanged, tested paused campaign', async () => {
    const { component, call, haptics } = setup(vi.fn(async (name: string) => ({ data: name === 'changeMarketingCampaignStatus'
      ? { ...pausedCampaign, status: 'running' } : listing })));
    component.choose(pausedCampaign, false);
    component.togglePlan('pro', true);
    expect(component.draft.filters.plans).toEqual(['free']);
    expect(component.dirty).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
    await component.change('resume');
    expect(call).toHaveBeenCalledWith('changeMarketingCampaignStatus', { id: pausedCampaign.id, action: 'resume',
      draft: expect.objectContaining({ subject: pausedCampaign.subject, content: pausedCampaign.content, cta: pausedCampaign.cta }) });
    expect(component.canEdit).toBe(false);
    expect(haptics.success).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });
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
    expect(call).toHaveBeenCalledWith('sendMarketingTest', { id: 'campaign_1234567890', to: 'qa@example.org',
      draft: expect.objectContaining({ subject: component.draft.subject }) });
    expect(component.notice).toContain('qa@example.org');
  });
  it('sends the unsaved composer without creating a campaign', async () => {
    const { component, call } = setup();
    component.draft.subject = 'Test subject';
    component.draft.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A test message' }] }] };
    component.testTo = ' jimmykane9@gmail.com ';
    expect(component.canSendTest).toBe(false);
    component.preview = { from: 'Dimitrios from Quantified Self <updates@quantified-self.io>', replyTo: 'Dimitrios <dimitrios@quantified-self.io>', subject: 'Test subject', html: '<p>A test message</p>', text: 'A test message' };
    expect(component.canSendTest).toBe(true);
    await component.sendTest();
    expect(call).toHaveBeenCalledWith('sendMarketingTest', { id: null, to: 'jimmykane9@gmail.com',
      draft: expect.objectContaining({ name: 'Test message', subject: 'Test subject' }) });
    expect(call).not.toHaveBeenCalledWith('saveMarketingCampaign', expect.anything());
    expect(component.notice).toContain('Check that inbox');
  });
  it('shows the test recipient field before a campaign is saved', async () => {
    setup();
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.writing-column input[type="email"]')).not.toBeNull();
    fixture.destroy();
  });
  it('keeps Send test disabled until the recipient address is valid', async () => {
    setup();
    const fixture = TestBed.createComponent(AdminMarketingComponent);
    fixture.componentInstance.preview = { from: 'Dimitrios from Quantified Self <updates@quantified-self.io>', replyTo: 'Dimitrios <dimitrios@quantified-self.io>', subject: 'A note', html: '<p>Hello</p>', text: 'Hello' };
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.test-send input[type="email"]') as HTMLInputElement;
    const button = fixture.nativeElement.querySelector('.test-send button') as HTMLButtonElement;
    input.value = 'not-an-email';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    input.value = 'qa@example.org';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    fixture.destroy();
  });
  it('blocks testing while a preview is stale or button details are incomplete', () => {
    const { component } = setup();
    component.draft.subject = 'A note';
    component.draft.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
    component.testTo = 'qa@example.org';
    component.preview = { from: 'Dimitrios from Quantified Self <updates@quantified-self.io>', replyTo: 'Dimitrios <dimitrios@quantified-self.io>', subject: 'A note', html: '<p>Hello</p>', text: 'Hello' };
    expect(component.canSendTest).toBe(true);
    component.schedulePreview();
    expect(component.canSendTest).toBe(false);
    component.setCta(true);
    expect(component.previewError).toContain('button label');
    expect(component.canSendTest).toBe(false);
    component.ngOnDestroy();
  });
  it('renders a live server preview from an unsaved message without sending mail', async () => {
    const preview = { from: 'Dimitrios from Quantified Self <updates@quantified-self.io>', replyTo: 'Dimitrios <dimitrios@quantified-self.io>', subject: 'Subject', html: '<p>Hello</p>', text: 'Hello' };
    const call = vi.fn(async (name: string) => ({ data: name === 'previewMarketingCampaign' ? preview : listing }));
    const { component, haptics } = setup(call);
    component.draft.subject = 'Subject';
    component.draft.senderName = 'Dimitrios';
    component.draft.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
    vi.useFakeTimers();
    try {
      component.schedulePreview();
      await vi.advanceTimersByTimeAsync(900);
      expect(component.preview).toEqual(preview);
      expect(call).toHaveBeenCalledWith('previewMarketingCampaign', { draft: expect.objectContaining({ name: 'Preview', subject: 'Subject', senderName: 'Dimitrios' }) });
      expect(haptics.success).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); component.ngOnDestroy(); }
  });
  it('keeps the email template CSS in a sandboxed preview beside a saved draft', async () => {
    const html = '<!doctype html><html><head><style>body{color:#123456}</style></head><body style="margin:0"><p>Hello</p></body></html>';
    const call = vi.fn(async (name: string) => ({ data: name === 'previewMarketingCampaign'
      ? { from: 'Dimitrios from Quantified Self <updates@quantified-self.io>', replyTo: 'Dimitrios <dimitrios@quantified-self.io>', subject: 'A note', html, text: 'Hello' } : listing }));
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
      const headers = fixture.nativeElement.querySelector('.preview-headers') as HTMLElement;
      expect(headers.textContent).toContain('Dimitrios from Quantified Self <updates@quantified-self.io>');
      expect(headers.textContent).toContain('Dimitrios <dimitrios@quantified-self.io>');
      expect(frame?.getAttribute('srcdoc')).toContain('<style>body{color:#123456}</style>');
      expect(frame?.getAttribute('srcdoc')).toContain('style="margin:0"');
      expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      expect(fixture.nativeElement.querySelector('input[type="email"]')).not.toBeNull();
    } finally { fixture.destroy(); vi.useRealTimers(); }
  });
});
