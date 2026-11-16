import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AppUserInterface } from '../models/app-user.interface';
import { needsPreferencesSetup, type PreferencesSetupPatch } from '../helpers/preferences-setup.helper';
import { AppUserService } from './app.user.service';
import { AppHapticsService } from './app.haptics.service';
import { LoggerService } from './logger.service';

/** Shares the existing account stream and completion flag; no additional reads or polling. */
@Injectable({ providedIn: 'root' })
export class PreferencesSetupService {
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  private readonly logger = inject(LoggerService);
  private readonly destroy = inject(DestroyRef);
  private epoch = 0;
  readonly ownerRevision = signal(0);
  private readonly completed = signal<ReadonlySet<string>>(new Set());
  readonly user = signal<AppUserInterface | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly due = computed(() => needsPreferencesSetup(this.user()) && !this.completed().has(this.user()!.uid));

  constructor() {
    this.users.user$.pipe(takeUntilDestroyed()).subscribe(user => {
      if (user?.uid !== this.user()?.uid) {
        this.epoch++;
        this.ownerRevision.set(this.epoch);
        this.busy.set(false);
        this.error.set('');
      }
      this.user.set(user);
    });
  }

  async complete(uid: string, patch: PreferencesSetupPatch = { appSettings: { unitSetupCompleted: true } }, expectedRevision = this.ownerRevision()): Promise<boolean> {
    const user = this.user(), epoch = this.epoch;
    if (!user || user.uid !== uid || expectedRevision !== this.ownerRevision() || !this.due() || this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.users.updateUserProperties(user, { settings: patch });
      if (!this.current(uid, epoch)) return false;
      this.completed.update(previous => new Set([...previous, uid]));
      this.haptics.success();
      return true;
    } catch (error) {
      if (this.current(uid, epoch)) {
        this.error.set('Could not save your preferences. Please try again.');
        this.logger.error('[PreferencesSetup] Could not save preferences', error);
        this.haptics.error();
      }
      return false;
    } finally {
      if (this.current(uid, epoch)) this.busy.set(false);
    }
  }
  private current(uid: string, epoch: number): boolean {
    return !this.destroy.destroyed && this.user()?.uid === uid && this.epoch === epoch;
  }
}
