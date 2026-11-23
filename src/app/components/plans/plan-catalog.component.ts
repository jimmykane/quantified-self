import { ChangeDetectionStrategy, Component, DestroyRef, LOCALE_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Auth } from 'app/firebase/auth';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppUserService } from '../../services/app.user.service';
import { PlanAttributionComponent } from './plan-attribution.component';
import { templateScheduleMode, TRAINING_PLAN_CATALOG, type PlanTemplate, type TemplateScheduleOptions } from '@shared/training-plan-templates';
import { PLAN_WEEKDAYS } from '@shared/training-plan-generation';
import { formatManualWorkoutStructure } from '../../helpers/planned-workout-editor.helper';
import { aggregateWorkoutAnalysesV1, analyzeWorkoutStructureV1 } from '@shared/planned-workout-analysis';
import { formatWorkoutAnalysisSummaryV1, formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { WorkoutProfileComponent } from './workout-profile.component';

type Summary = Omit<PlanTemplate, 'sessions' | 'rest' | 'phases'> & { workoutCount: number };
type Preview = { id: string; name: string; start: string; end: string; dates: string[]; restDays: string[]; conflicts: string[] };
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

@Component({
  selector: 'app-plan-catalog', standalone: true, imports: [FormsModule, RouterLink, MatButtonModule, WorkoutProfileComponent, PlanAttributionComponent],
  templateUrl: './plan-catalog.component.html', styleUrls: ['./plan-catalog.component.scss'], changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanCatalogComponent {
  readonly users = inject(AppUserService);
  private readonly auth = inject(Auth);
  private readonly functions = inject(AppFunctionsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private generation = 0;
  readonly source = signal<PlanTemplate['source']>('catalog');
  readonly items = signal<Summary[]>([]);
  readonly selected = signal<PlanTemplate | null>(null);
  readonly flexibleDays = computed(() => {
    const plan = this.selected();
    return !!plan && templateScheduleMode(plan) === 'flexible';
  });
  readonly week = signal(0);
  readonly options = signal<TemplateScheduleOptions>({ anchor: 'start', date: today(), longDay: 0, pattern: 'standard' });
  readonly weekdays = PLAN_WEEKDAYS;
  readonly preview = signal<Preview | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly weeks = computed(() => Array.from({ length: Math.ceil((this.selected()?.days ?? 0) / 7) }, (_, i) => i));
  readonly sessions = computed(() => this.selected()?.sessions.filter(s => Math.floor(s.day / 7) === this.week()) ?? []);
  private readonly locale = inject(LOCALE_ID);
  readonly weekRows = computed(() => this.sessions().map(s => ({ ...s,
    totals: formatWorkoutPrescriptionSummaryV1(s.structure, this.users.user()?.settings?.unitSettings ?? null, s.structure.sport, this.locale),
    steps: formatManualWorkoutStructure(s.structure, this.users.user()?.settings?.unitSettings ?? null, this.locale, true) })));
  readonly workloads = computed(() => {
    const plan = this.selected();
    if (!plan) return [];
    const settings = this.users.user()?.settings?.unitSettings ?? null;
    const weeks = this.weeks().map(index => {
      const workouts = plan.sessions.filter(s => Math.floor(s.day / 7) === index);
      try {
        const total = aggregateWorkoutAnalysesV1(workouts.map(s => analyzeWorkoutStructureV1(s.structure)), { sourceComplete: true });
        const sport = workouts.length && workouts.every(s => s.structure.sport === workouts[0].structure.sport) ? workouts[0].structure.sport : undefined;
        return { seconds: total.summary.duration.coveredSubtotalRange?.maximumSeconds ?? 0,
          partial: !total.summary.duration.completeRange, text: formatWorkoutAnalysisSummaryV1(total.summary, settings, sport, this.locale) };
      } catch { return { seconds: 0, partial: true, text: 'Weekly totals unavailable' }; }
    });
    const peak = Math.max(1, ...weeks.map(w => w.seconds));
    return weeks.map(w => ({ ...w, percent: w.seconds / peak * 100 }));
  });
  patternLabel(pattern: TemplateScheduleOptions['pattern']): string {
    const plan = this.selected();
    if (!plan) return '';
    return plan.sessions.filter(s => s.day < 7).map(s => this.dayLabel(s.day, true, pattern)).join(' · ');
  }
  dayLabel(offset: number, workout = false, pattern = this.options().pattern): string {
    if (!this.flexibleDays()) return 'Day ' + (offset + 1);
    const index = workout && pattern === 'early' && offset % 7 === 1 ? offset - 1 : offset;
    const weekday = (this.options().longDay + 1 + index) % 7;
    return this.weekdays.find(d => d.value === weekday)?.label ?? '';
  }
  readonly weekRest = computed(() => (this.selected()?.rest ?? []).filter(day => Math.floor(day / 7) === this.week()));
  readonly ownerUid = computed(() => this.users.user()?.uid);
  readonly weekPhases = computed(() => {
    const firstDay = this.week() * 7;
    return this.selected()?.phases.filter(phase => phase.start < firstDay + 7 && phase.end >= firstDay) ?? [];
  });
  constructor() {
    effect(() => {
      const uid = this.ownerUid();
      untracked(() => { void this.openSource('catalog', uid); });
    });
  }
  private async request<T>(payload: Record<string, unknown>, current: () => boolean) {
    return (await this.functions.call<Record<string, unknown>, T>('trainingPlanTemplates', payload, { canExecute: current })).data;
  }
  private async run(work: (current: () => boolean) => Promise<void>) {
    const generation = ++this.generation, uid = this.users.user()?.uid, session = this.auth.currentUser;
    const current = () => !this.destroy.destroyed && !!uid && session?.uid === uid && session === this.auth.currentUser &&
      this.users.user()?.uid === uid && generation === this.generation;
    this.error.set('');
    if (!current()) { this.busy.set(false); return; }
    this.busy.set(true);
    try { await work(current); }
    catch (e) { if (current()) this.error.set(e instanceof Error ? e.message : 'Could not load the plan. Try again.'); }
    finally { if (current()) this.busy.set(false); }
  }
  async openSource(source: PlanTemplate['source'], uid = this.users.user()?.uid) {
    this.generation++;
    this.source.set(source); this.selected.set(null); this.items.set([]); this.preview.set(null); this.week.set(0); this.error.set('');
    if (!uid) { this.busy.set(false); return; }
    if (source === 'catalog') {
      this.items.set(TRAINING_PLAN_CATALOG.map(t => ({ ...t, workoutCount: t.sessions.length })));
      this.selected.set(TRAINING_PLAN_CATALOG.find(t => t.id === this.route.snapshot.queryParamMap.get('template')) ?? TRAINING_PLAN_CATALOG[0]);
      this.busy.set(false);
    } else await this.run(async current => {
      const items = await this.request<Summary[]>({ action: 'list', source }, current);
      if (!current()) return;
      this.items.set(items);
      if (items.length) await this.select(items[0]);
    });
  }
  selectById(id: string): void {
    const item = this.items().find(t => t.id === id);
    if (item) void this.select(item);
  }
  async select(item: Summary) {
    this.preview.set(null); this.week.set(0); this.selected.set(null);
    await this.run(async current => {
      const template = item.source === 'catalog' ? TRAINING_PLAN_CATALOG.find(t => t.id === item.id)
        : await this.request<PlanTemplate>({ action: 'get', source: item.source, id: item.id }, current);
      if (current() && template) this.selected.set(template);
    });
  }
  change(options: Partial<TemplateScheduleOptions>) {
    this.generation++; this.busy.set(false); this.preview.set(null); this.error.set('');
    const next = { ...this.options(), ...options };
    if (next.anchor === 'finish' && next.date) next.longDay = new Date(next.date + 'T12:00:00Z').getUTCDay();
    this.options.set(next);
  }
  async review() {
    const item = this.selected();
    if (!item || this.busy()) return;
    this.preview.set(null);
    await this.run(async current => {
      const result = await this.request<Preview>({ action: 'preview', source: item.source, id: item.id, version: item.version, options: this.options() }, current);
      if (current()) this.preview.set(result);
    });
  }
  async confirm() {
    const review = this.preview();
    if (!review || this.busy()) return;
    await this.run(async current => {
      const result = await this.request<{planId: string}>({ action: 'apply', proposalId: review.id }, current);
      if (current()) await this.router.navigate(['/training/plans/plan', result.planId]);
    });
  }
}
