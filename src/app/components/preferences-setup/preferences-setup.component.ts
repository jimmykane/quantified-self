import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { BreakpointObserver } from '@angular/cdk/layout';
import { PreferencesSetupService } from '../../services/preferences-setup.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { createPreferencesDraft, preferencesSummary } from '../../helpers/preferences-setup.helper';

@Component({ selector: 'app-preferences-setup', standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './preferences-setup.component.html', styleUrl: './preferences-setup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class PreferencesSetupComponent {
  readonly ownerUid = input<string | null>(null);
  readonly shellPlacement = input(false);
  readonly state = inject(PreferencesSetupService);
  private readonly dialogs = inject(MatDialog);
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);
  readonly opening = signal(false);
  readonly dialogOpen = signal(false);
  readonly locked = computed(() => this.state.busy() || this.opening() || this.dialogOpen());
  readonly visible = computed(() => this.state.due() && (!this.ownerUid() || this.ownerUid() === this.state.user()?.uid));
  readonly summary = computed(() => {
    const user = this.state.user();
    return user ? preferencesSummary(createPreferencesDraft(user).units) : '';
  });

  async review(): Promise<void> {
    const user = this.state.user(), revision = this.state.ownerRevision();
    if (!this.visible() || !user || this.locked()) return;
    this.opening.set(true); this.state.error.set(''); this.haptics.selection();
    try {
      const { PreferencesSetupDialogComponent } = await import('./preferences-setup-dialog.component');
      if (this.destroy.destroyed || revision !== this.state.ownerRevision() || !this.visible()) return;
      const handset = this.breakpoints.isMatched('(max-width: 599px)');
      const ref = this.dialogs.open(PreferencesSetupDialogComponent, { width: handset ? '100vw' : '584px',
        maxWidth: '100vw', maxHeight: '92dvh', position: handset ? {bottom: '0'} : undefined,
        autoFocus: 'first-heading', data: { user: this.state.user() } });
      this.dialogOpen.set(true);
      ref.afterClosed().subscribe(() => { if (!this.destroy.destroyed) this.dialogOpen.set(false); });
    } catch {
      if (!this.destroy.destroyed && revision === this.state.ownerRevision()) {
        this.state.error.set('Could not open your preferences. Please try again.'); this.haptics.error();
      }
    } finally { if (!this.destroy.destroyed) this.opening.set(false); }
  }
  async keepDefaults(): Promise<void> {
    const uid = this.state.user()?.uid;
    if (!uid || !this.visible() || this.locked()) return;
    await this.state.complete(uid);
  }
}
