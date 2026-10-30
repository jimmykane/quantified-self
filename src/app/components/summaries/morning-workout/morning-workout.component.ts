import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { MorningWorkoutStatus } from '@shared/morning-workout';
import { isMorningWorkoutWindow } from '@shared/morning-workout';
import { MorningWorkoutService } from '../../../services/morning-workout.service';
import { DayWorkoutService } from '../../../services/day-workout.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppChartSharedModule } from '../../../modules/app-chart-shared.module';
import { dayWorkoutReview } from '../../../helpers/day-workout-review.helper';
import { CompactRowComponent } from '../../shared/compact-row/compact-row.component';
import { AppUserService } from '../../../services/app.user.service';

@Component({ selector: 'app-morning-workout', standalone: true,
  imports: [CompactRowComponent, MatButtonModule, MatIconModule, MatMenuModule, MatProgressBarModule, AppChartSharedModule],
  templateUrl: './morning-workout.component.html', styleUrl: './morning-workout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class MorningWorkoutComponent {
  readonly ownerUid = input.required<string>();
  readonly localDate = input.required<string>();
  readonly dataReady = input(false);
  readonly morning = inject(MorningWorkoutService);
  private readonly generation = inject(DayWorkoutService);
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  readonly eligible = computed(() => this.morning.eligible(this.ownerUid()));
  readonly preferences = computed(() => { this.localDate(); return this.morning.preferences(); },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  readonly status = signal<MorningWorkoutStatus | null>(null);
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly visible = signal(this.document.visibilityState !== 'hidden');
  readonly summary = computed(() => {
    const value = this.status();
    if (value?.state === 'ready' && value.result) {
      const draft = value.result.draft;
      return draft ? `${draft.title} · ${dayWorkoutReview(draft, this.users.user()?.settings?.unitSettings).summary}` : 'A recovery day';
    }
    if (this.busy()) return 'Preparing with your latest available context…';
    if (this.error() || value?.state === 'failed') return 'Today’s suggestion could not finish.';
    if (value?.state === 'planned') return 'Today already has a planned workout.';
    if (value?.state === 'completed') return 'You already recorded a workout today.';
    if (value?.state === 'rest-day') return 'Today is a planned rest day.';
    if (value?.state === 'dismissed') return 'Dismissed for today.';
    if (value?.state === 'preparing') return 'Your suggestion is being prepared.';
    return 'Prepared on your first visit between 5 am and noon.';
  });
  private sequence = 0;
  private shown = new Set<string>();
  constructor() {
    const visibility = () => this.visible.set(this.document.visibilityState !== 'hidden');
    this.document.addEventListener('visibilitychange', visibility);
    this.destroy.onDestroy(() => { this.sequence++; this.document.removeEventListener('visibilitychange', visibility); });
    effect(onCleanup => {
      // Track only the owner, day, settled Today data, preferences and foreground state.
      const eligible = this.eligible(), enabled = this.preferences().enabled, saving = this.morning.saving();
      this.ownerUid(); this.localDate(); this.preferences(); this.dataReady(); this.visible();
      this.sequence++; this.status.set(null); this.error.set(false); this.busy.set(false);
      if (!eligible || !enabled || saving || !this.dataReady() || !this.visible()) return;
      const timer = setTimeout(() => { untracked(() => { void this.load(); }); }, 1500);
      onCleanup(() => clearTimeout(timer));
    });
  }
  private current(sequence: number, uid: string): boolean {
    return !this.destroy.destroyed && sequence === this.sequence && uid === this.ownerUid() && this.morning.eligible(uid);
  }
  async load(): Promise<void> {
    const uid = this.ownerUid(), sequence = ++this.sequence;
    if (!this.morning.eligible(uid) || !this.preferences().enabled || !this.visible()) return;
    this.busy.set(true); this.error.set(false);
    try {
      let status = await this.morning.request(uid, 'status', () => this.current(sequence, uid));
      if (!this.current(sequence, uid)) return;
      if (status.state === 'waiting' && this.dataReady() && isMorningWorkoutWindow(new Date(), this.preferences().controls.timeZone)) {
        status = await this.morning.request(uid, 'prepare', () => this.current(sequence, uid));
      }
      if (!this.current(sequence, uid)) return;
      this.status.set(status);
      const shownKey = `${uid}:${status.localDate}:${status.state}`;
      if (!this.shown.has(shownKey) && ['ready', 'planned', 'completed', 'rest-day'].includes(status.state)) {
        this.shown.add(shownKey); this.morning.event(uid, 'shown', status.state);
      }
    } catch { if (this.current(sequence, uid)) { this.error.set(true); this.morning.event(uid, 'failed'); } }
    finally { if (this.current(sequence, uid)) this.busy.set(false); }
  }
  async configure(): Promise<void> {
    const uid = this.ownerUid(), preferences = this.preferences();
    await this.generation.open(uid, preferences.controls.localDate, preferences.controls.sport, {
      mode: 'preferences', initialControls: preferences.controls, followRoutine: preferences.followRoutine,
      savePreferences: async (controls, followRoutine) => {
        await this.morning.save(uid, { enabled: true, controls, followRoutine });
        this.morning.event(uid, 'enabled');
      },
    });
  }
  async review(): Promise<void> {
    const value = this.status(), uid = this.ownerUid();
    if (value?.state !== 'ready' || !value.controls || !value.result || !this.morning.eligible(uid)) return;
    this.morning.event(uid, 'reviewed', 'ready');
    await this.generation.open(uid, value.localDate, value.controls.sport, { initialControls: value.controls, initialResult: value.result,
      onAdded: () => { this.morning.event(uid, 'added', 'ready'); if (!this.destroy.destroyed && this.morning.isOwner(uid) && this.ownerUid() === uid) this.status.set({ localDate: value.localDate, state: 'planned' }); },
    });
  }
  async manual(): Promise<void> {
    const uid = this.ownerUid(), controls = this.preferences().controls;
    await this.generation.open(uid, controls.localDate, controls.sport, { initialControls: controls });
  }
  async dismiss(): Promise<void> {
    const uid = this.ownerUid(), sequence = ++this.sequence;
    this.busy.set(true);
    try {
      const status = await this.morning.request(uid, 'dismiss', () => this.current(sequence, uid));
      if (this.current(sequence, uid)) { this.status.set(status); this.haptics.success(); this.morning.event(uid, 'dismissed'); }
    } catch { if (this.current(sequence, uid)) { this.error.set(true); this.haptics.error(); } }
    finally { if (this.current(sequence, uid)) this.busy.set(false); }
  }
  async disable(): Promise<void> {
    const uid = this.ownerUid(), sequence = ++this.sequence;
    this.busy.set(true);
    try {
      await this.morning.save(uid, { ...this.preferences(), enabled: false });
      if (this.current(sequence, uid)) { this.haptics.success(); this.morning.event(uid, 'disabled'); }
    } catch { if (this.current(sequence, uid)) { this.error.set(true); this.haptics.error(); } }
    finally { if (this.current(sequence, uid)) this.busy.set(false); }
  }
}
