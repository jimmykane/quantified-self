import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { INACTIVITY_DELETION_LIMIT, INACTIVITY_WARNING_LIMIT, type InactivityAdminResponse,
  type InactivityAdminView, type InactivityMode, type InactivitySettings } from '@shared/admin-inactivity';
import { AdminInactivityService } from '../../../services/admin-inactivity.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { CompactSelectComponent, CompactSelectOption } from '../../shared/compact-select/compact-select.component';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../../confirmation-dialog/confirmation-dialog.component';

@Component({ selector: 'app-admin-inactive-accounts', standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule, MatCardModule, MatDialogModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, PageHeaderComponent, CompactSelectComponent],
  templateUrl: './admin-inactive-accounts.component.html', styleUrl: './admin-inactive-accounts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class AdminInactiveAccountsComponent implements OnInit, OnDestroy {
  private readonly service = inject(AdminInactivityService);
  private readonly haptics = inject(AppHapticsService);
  private readonly dialog = inject(MatDialog);
  private confirmation: MatDialogRef<ConfirmationDialogComponent, boolean> | null = null;
  private owner = this.service.currentUid();
  private unwatch?: () => void;
  private sequence = 0;
  private destroyed = false;
  private cursors: Array<string | undefined> = [undefined];
  readonly data = signal<InactivityAdminResponse | null>(null);
  readonly baseline = signal<InactivitySettings | null>(null);
  readonly view = signal<InactivityAdminView>('queued');
  readonly page = signal(1);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly mode = signal<InactivityMode>('off');
  readonly warningLimit = signal<number | null>(INACTIVITY_WARNING_LIMIT);
  readonly deletionLimit = signal<number | null>(INACTIVITY_DELETION_LIMIT);
  readonly maximumWarnings = INACTIVITY_WARNING_LIMIT;
  readonly maximumDeletions = INACTIVITY_DELETION_LIMIT;
  readonly modes: CompactSelectOption<InactivityMode>[] = [
    { value: 'off', label: 'Off' }, { value: 'dry-run', label: 'Dry run' },
    { value: 'warnings-only', label: 'Warnings only' }, { value: 'enforce', label: 'Enforce deletion' },
  ];
  readonly views: CompactSelectOption<InactivityAdminView>[] = [
    { value: 'queued', label: 'Warning delivery' }, { value: 'warned', label: 'Deletion deadlines' },
    { value: 'pending-deletion', label: 'Deletion follow-up' }, { value: 'cancelled', label: 'Cancelled notices' },
  ];
  readonly modeDescriptions: Record<InactivityMode, string> = {
    off: 'Stops new retention checks. Queued emails and cleanup already started can still finish.',
    'dry-run': 'Checks eligibility without sending warnings or initiating account deletion.',
    'warnings-only': 'Sends and checks warning emails. Accounts are not deleted in this mode.',
    enforce: 'Deletes eligible Free accounts after confirmed warning delivery and the full 30-day period. Existing elapsed notices can become actionable on the next run.',
  };
  readonly description = computed(() => this.modeDescriptions[this.mode()]);
  readonly currentModeLabel = computed(() => this.modes.find(mode => mode.value === this.data()?.settings.mode)?.label ?? 'Unavailable');
  readonly dirty = computed(() => !!this.baseline() && (this.mode() !== this.baseline()!.mode
    || this.warningLimit() !== this.baseline()!.warningDailyLimit || this.deletionLimit() !== this.baseline()!.deletionDailyLimit));
  readonly conflict = computed(() => !!this.baseline() && this.baseline()!.revision !== this.data()?.settings.revision);
  readonly canSave = computed(() => this.dirty() && !this.conflict() && this.data()?.settingsValid && !this.loading() && !this.saving() && !this.error()
    && Number.isSafeInteger(this.warningLimit()) && this.warningLimit()! >= 0 && this.warningLimit()! <= INACTIVITY_WARNING_LIMIT
    && Number.isSafeInteger(this.deletionLimit()) && this.deletionLimit()! >= 0 && this.deletionLimit()! <= INACTIVITY_DELETION_LIMIT);

  ngOnInit(): void {
    this.unwatch = this.service.watchOwner(uid => {
      if (uid === this.owner) return;
      this.owner = uid; this.sequence++; this.data.set(null); this.baseline.set(null);
      this.loading.set(false); this.saving.set(false); this.notice.set('');
      this.error.set('The signed-in account changed. Refresh to continue.'); this.confirmation?.close();
    });
    void this.load();
  }
  ngOnDestroy(): void { this.destroyed = true; this.sequence++; this.unwatch?.(); this.confirmation?.close(); }
  private syncDraft(settings: InactivitySettings): void {
    this.baseline.set(settings); this.mode.set(settings.mode); this.warningLimit.set(settings.warningDailyLimit); this.deletionLimit.set(settings.deletionDailyLimit);
  }
  private async load(resetDraft = false, userAction = false): Promise<void> {
    const sequence = ++this.sequence;
    const owner = this.owner;
    this.loading.set(true); this.error.set('');
    try {
      const afterUid = this.cursors[this.page() - 1];
      const result = await this.service.read({ view: this.view(), ...(afterUid ? { afterUid } : {}) });
      if (this.destroyed || sequence !== this.sequence || owner !== this.owner) return;
      if (resetDraft || !this.dirty()) this.syncDraft(result.settings);
      this.data.set(result);
    } catch {
      if (this.destroyed || sequence !== this.sequence || owner !== this.owner) return;
      this.error.set('Unable to load account retention. Refresh to try again.');
      if (userAction) this.haptics.error();
    } finally { if (!this.destroyed && sequence === this.sequence) this.loading.set(false); }
  }
  refresh(): void {
    if (this.loading() || this.saving() || this.dirty()) return;
    this.haptics.selection(); this.cursors = [undefined]; this.page.set(1); void this.load(true, true);
  }
  reset(): void {
    if (!this.data() || this.saving() || this.loading()) return;
    this.haptics.selection(); this.syncDraft(this.data()!.settings); this.notice.set('');
  }
  changeMode(mode: InactivityMode): void {
    if (mode === this.mode() || this.loading() || this.saving()) return;
    this.mode.set(mode); this.notice.set(''); this.haptics.selection();
  }
  changeView(view: InactivityAdminView): void {
    if (view === this.view() || this.loading() || this.saving()) return;
    this.view.set(view); this.cursors = [undefined]; this.page.set(1); this.haptics.selection(); void this.load(false, true);
  }
  next(): void {
    if (!this.data()?.nextUid || this.loading() || this.saving()) return;
    this.cursors.push(this.data()!.nextUid!); this.page.update(value => value + 1); this.haptics.selection(); void this.load(false, true);
  }
  previous(): void {
    if (this.page() <= 1 || this.loading() || this.saving()) return;
    this.cursors.pop(); this.page.update(value => value - 1); this.haptics.selection(); void this.load(false, true);
  }
  async save(): Promise<void> {
    if (!this.canSave() || !this.owner) return;
    const owner = this.owner;
    const settings = { mode: this.mode(), warningDailyLimit: this.warningLimit()!, deletionDailyLimit: this.deletionLimit()!, revision: this.baseline()!.revision };
    this.saving.set(true); this.notice.set(''); this.haptics.selection();
    this.confirmation = this.dialog.open<ConfirmationDialogComponent, ConfirmationDialogData, boolean>(ConfirmationDialogComponent, {
      data: { title: settings.mode === 'enforce' ? 'Enable account deletion?' : 'Save retention settings?',
        message: `${this.modeDescriptions[settings.mode]} Daily limits: ${settings.warningDailyLimit} warnings and ${settings.deletionDailyLimit} deletion initiations.`,
        confirmText: settings.mode === 'enforce' ? 'Save enforcement settings' : 'Save settings',
        cancelText: 'Cancel', confirmColor: settings.mode === 'enforce' ? 'warn' : 'primary' },
    });
    try {
      const confirmed = await firstValueFrom(this.confirmation.afterClosed());
      if (confirmed !== true || this.destroyed || owner !== this.owner) return;
      await this.service.save(settings, owner);
      if (this.destroyed || owner !== this.owner) return;
      this.haptics.success(); this.notice.set('Settings saved. The daily job will use the updated settings.');
      await this.load(true);
    } catch {
      if (this.destroyed || owner !== this.owner) return;
      this.error.set('Settings were not confirmed saved. Reset changes and refresh before trying again; another administrator may have changed them.');
      this.haptics.error();
    } finally { this.confirmation = null; if (!this.destroyed && owner === this.owner) this.saving.set(false); }
  }
}
