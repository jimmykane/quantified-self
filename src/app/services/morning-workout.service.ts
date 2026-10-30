import { Injectable, inject, signal } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { defaultDayWorkoutControls, dayWorkoutLocalDate } from '@shared/day-workout';
import { parseMorningWorkoutPreferences, type MorningWorkoutPreferences, type MorningWorkoutRequest, type MorningWorkoutStatus } from '@shared/morning-workout';
import { AppFunctionsService } from './app.functions.service';
import { AppUserService } from './app.user.service';
import { AppAnalyticsService } from './app.analytics.service';

@Injectable({ providedIn: 'root' })
export class MorningWorkoutService {
  private readonly auth = inject(Auth);
  private readonly users = inject(AppUserService);
  private readonly functions = inject(AppFunctionsService);
  private readonly analytics = inject(AppAnalyticsService);
  private writes: Promise<void> = Promise.resolve();
  readonly saving = signal(false);
  isOwner(uid: string): boolean { return !!uid && this.auth.currentUser?.uid === uid && this.users.user()?.uid === uid; }
  eligible(uid: string): boolean { return this.isOwner(uid) && this.users.isProSignal(); }
  preferences(): MorningWorkoutPreferences {
    try { return parseMorningWorkoutPreferences(this.users.user()?.settings?.appSettings?.morningWorkout); }
    catch {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { enabled: false, followRoutine: true, controls: defaultDayWorkoutControls(dayWorkoutLocalDate(new Date(), zone), zone) };
    }
  }
  async request(uid: string, action: MorningWorkoutRequest['action'], current: () => boolean, expectedDate?: string): Promise<MorningWorkoutStatus> {
    if (!this.eligible(uid) || !current()) throw Error('Morning suggestion access changed.');
    if (action === 'dismiss' && !expectedDate) throw Error('Choose the day to dismiss.');
    const request: MorningWorkoutRequest = action === 'dismiss'
      ? { mode: 'morning', action, localDate: expectedDate! } : { mode: 'morning', action };
    return (await this.functions.call<MorningWorkoutRequest, MorningWorkoutStatus>('generateDayWorkout', request,
      { canExecute: () => this.eligible(uid) && current() })).data;
  }
  save(uid: string, value: MorningWorkoutPreferences): Promise<void> {
    const preferences = parseMorningWorkoutPreferences(value);
    const write = this.writes.then(async () => {
      if (!this.eligible(uid)) throw Error('The signed-in account changed.');
      const user = this.users.user()!;
      this.saving.set(true);
      try { await this.users.updateUserProperties(user, { settings: { appSettings: { morningWorkout: preferences } } }); }
      finally { this.saving.set(false); }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
  event(uid: string, action: 'shown' | 'reviewed' | 'added' | 'dismissed' | 'enabled' | 'preferences_saved' | 'disabled' | 'failed',
    state?: MorningWorkoutStatus['state']): void {
    if (this.eligible(uid)) this.analytics.logEvent('morning_workout', { action, ...(state ? { state } : {}) });
  }
}
