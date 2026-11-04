import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { isTrainingPlanRestDay } from '@shared/training-plans';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';

@Component({
  selector: 'app-current-plan-rest-day', standalone: true, imports: [MatButtonModule],
  templateUrl: './current-plan-rest-day.component.html', styleUrl: './current-plan-rest-day.component.scss',
  host: { '[style.display]': "isRestDay() ? 'block' : 'none'" }, changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrentPlanRestDayComponent {
  readonly ownerUid = input<string | null>(null);
  // The parent's caption can read the exported state before Angular binds child inputs.
  readonly localDate = input('');
  private readonly users = inject(AppUserService);
  private readonly plans = inject(TrainingPlansService);
  private readonly router = inject(Router);
  private readonly haptics = inject(AppHapticsService);
  private readonly owner = computed(() => this.ownerUid() && this.ownerUid() === this.users.user()?.uid ? this.ownerUid() : null);
  private readonly current = toSignal(toObservable(this.owner).pipe(switchMap(uid => uid
    ? this.plans.watchActivePlan(uid).pipe(map(plan => ({ uid, plan })), startWith({ uid, plan: null }), catchError(() => of({ uid, plan: null })))
    : of({ uid: null, plan: null }))), { initialValue: { uid: null, plan: null } });
  private readonly calendarScope = computed(() => this.owner() && this.localDate() ? JSON.stringify([this.owner(), this.localDate()]) : '');
  private readonly calendar = toSignal(toObservable(this.calendarScope).pipe(switchMap(key => {
    if (!key) return of(null);
    const [uid, localDate] = JSON.parse(key) as [string, string];
    return this.plans.watchCalendarRestDay(uid, localDate).pipe(map(record => ({ uid, localDate, isRestDay: record?.isRestDay === true })),
      startWith(null), catchError(() => of(null)));
  })), { initialValue: null });
  readonly calendarRest = computed(() => this.calendar()?.uid === this.owner() && this.calendar()?.localDate === this.localDate() && this.calendar()?.isRestDay);
  readonly restName = computed(() => this.calendarRest() ? 'Calendar' : this.plan()?.name);
  readonly plan = computed(() => this.owner() && this.current().uid === this.owner() ? this.current().plan : null);
  readonly isRestDay = computed(() => !!this.calendarRest() || isTrainingPlanRestDay(this.plan(), this.localDate()));

  open(): void {
    if (this.calendarRest() && this.owner()) {
      this.haptics.selection(); void this.router.navigate(['/calendar/day', this.localDate()]); return;
    }
    const plan = this.plan();
    if (!plan || !this.isRestDay()) return;
    this.haptics.selection();
    void this.router.navigate(['/training/plans/plan', plan.id], { queryParams: { date: this.localDate() } });
  }
}
