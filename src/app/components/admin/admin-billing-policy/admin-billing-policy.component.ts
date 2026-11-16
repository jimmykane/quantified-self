import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { BillingTrialDays } from '@shared/billing-trial-policy';
import { AdminBillingTrialPolicyService, type AdminBillingTrialPolicyView } from '../../../services/admin-billing-trial-policy.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { ConfirmationDialogComponent, type ConfirmationDialogData } from '../../confirmation-dialog/confirmation-dialog.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { CompactSelectComponent, type CompactSelectOption } from '../../shared/compact-select/compact-select.component';

type TrialChoice = 'default' | '0' | '7' | '14' | '30';
const choice = (days: BillingTrialDays): TrialChoice => days === null ? 'default' : String(days) as TrialChoice;
const days = (value: TrialChoice): BillingTrialDays => value === 'default' ? null : Number(value) as BillingTrialDays;
const description = (value: TrialChoice): string => value === 'default' ? 'use each price’s existing offer' : value === '0' ? 'no free trial; payment starts at checkout' : `${value}-day free trial for eligible new members`;

@Component({ selector: 'app-admin-billing-policy', standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, PageHeaderComponent, CompactSelectComponent],
  templateUrl: './admin-billing-policy.component.html', styleUrl: './admin-billing-policy.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class AdminBillingPolicyComponent implements OnInit, OnDestroy {
  private readonly service = inject(AdminBillingTrialPolicyService);
  private readonly haptics = inject(AppHapticsService);
  private readonly dialog = inject(MatDialog);
  private owner = this.service.currentUid();
  private generation = 0;
  private destroyed = false;
  private unwatch?: () => void;
  private confirmation: MatDialogRef<ConfirmationDialogComponent, boolean> | null = null;
  readonly data = signal<AdminBillingTrialPolicyView | null>(null);
  readonly basic = signal<TrialChoice>('default');
  readonly pro = signal<TrialChoice>('default');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly options: CompactSelectOption<TrialChoice>[] = [
    { value: 'default', label: 'Use price settings' }, { value: '0', label: 'Off' },
    { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' },
  ];
  readonly summary = computed(() => `Basic: ${description(this.basic())}. Pro: ${description(this.pro())}.`);
  readonly dirty = computed(() => !!this.data() && (this.basic() !== choice(this.data()!.policy.basicTrialDays)
    || this.pro() !== choice(this.data()!.policy.proTrialDays)));
  readonly canSave = computed(() => this.dirty() && !this.loading() && !this.saving() && !this.error());
  ngOnInit(): void {
    this.unwatch = this.service.watchOwner(uid => {
      if (uid === this.owner) return;
      this.owner = uid; this.generation++; this.data.set(null); this.loading.set(false); this.saving.set(false); this.notice.set('');
      this.error.set('The signed-in account changed. Refresh to continue.'); this.confirmation?.close();
    });
    void this.load();
  }
  ngOnDestroy(): void { this.destroyed = true; this.generation++; this.unwatch?.(); this.confirmation?.close(); }
  async load(userAction = false): Promise<void> {
    if (this.loading() || this.saving()) return;
    if (userAction) this.haptics.selection();
    const generation = ++this.generation;
    this.loading.set(true); this.error.set(''); this.notice.set('');
    try {
      const view = await this.service.read();
      if (this.destroyed || generation !== this.generation) return;
      this.data.set(view); this.basic.set(choice(view.policy.basicTrialDays)); this.pro.set(choice(view.policy.proTrialDays));
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      this.error.set('Unable to load trial settings. Refresh to try again.');
      if (userAction) this.haptics.error();
    } finally { if (!this.destroyed && generation === this.generation) this.loading.set(false); }
  }
  select(plan: 'basic' | 'pro', value: TrialChoice): void {
    const selected = plan === 'basic' ? this.basic : this.pro;
    if (this.loading() || this.saving() || selected() === value || !this.options.some(option => option.value === value)) return;
    selected.set(value); this.notice.set(''); this.haptics.selection();
  }
  async save(): Promise<void> {
    if (!this.canSave() || !this.owner) return;
    const owner = this.owner, generation = this.generation;
    const current = () => !this.destroyed && generation === this.generation;
    const policy = { revision: this.data()!.policy.revision, basicTrialDays: days(this.basic()), proTrialDays: days(this.pro()) };
    this.saving.set(true); this.notice.set(''); this.haptics.selection();
    const confirmation = this.dialog.open<ConfirmationDialogComponent, ConfirmationDialogData, boolean>(ConfirmationDialogComponent, {
      data: { title: 'Update introductory trials?', message: `${this.summary()} Applies to new checkouts on monthly and yearly plans. Existing subscriptions and already accepted checkout terms keep their current terms.`,
        confirmText: 'Apply trial settings', cancelText: 'Cancel' },
    });
    this.confirmation = confirmation;
    try {
      if (await firstValueFrom(confirmation.afterClosed()) !== true || !current()) return;
      await this.service.save(policy, owner);
      if (!current()) return;
      this.data.set({ policy: { ...policy, revision: policy.revision + 1 }, updatedBy: owner, updatedAt: null });
      this.notice.set('Trial settings saved. New checkouts now use these offers.'); this.haptics.success();
    } catch {
      if (!current()) return;
      this.error.set('The change was not confirmed saved. Refresh before trying again; another administrator may have updated the offers.'); this.haptics.error();
    } finally {
      if (this.confirmation === confirmation) this.confirmation = null;
      if (current()) this.saving.set(false);
    }
  }
}
