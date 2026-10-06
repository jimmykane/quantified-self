import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, LOCALE_ID, afterRenderEffect, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { WorkoutStructureV1 } from '@shared/planned-workout';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RenderedThemeService } from '../../services/rendered-theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS, EChartsHostController } from '../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { isEChartsMobileTooltipViewport } from '../../helpers/echarts-tooltip-interaction.helper';
import { buildWorkoutProfileChartOption } from '../../helpers/workout-profile-chart.helper';
import { buildWorkoutProfile, workoutProfileOccurrenceCount, workoutProfileMetricLabels, WORKOUT_PROFILE_EXPANSION_BUDGET, type WorkoutProfileMetric, type WorkoutProfileOccurrence, type WorkoutProfileSelection } from '../../helpers/workout-profile.helper';

let nextProfileId = 0;

@Component({
  selector: 'app-workout-profile', standalone: true, imports: [CommonModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './workout-profile.component.html', styleUrls: ['./workout-profile.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkoutProfileComponent {
  readonly structure = input<WorkoutStructureV1 | null>(null);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  /** Change on owner/session/revision switch; editing the same recipe preserves selection by canonical ID. */
  readonly contextKey = input('');
  readonly initiallyExpanded = input(true);
  readonly unavailableReason = input('Enter valid workout step details to show the profile.');
  /** Integration point for server-validated Assistant review data; never interpreted as a mutation. */
  readonly changedStepIds = input<readonly string[]>([]);
  readonly stepSelected = output<WorkoutProfileSelection>();
  readonly regionId = `workout-profile-${++nextProfileId}`;
  readonly expanded = signal(true);
  readonly selectedKey = signal<string | null>(null);
  readonly selectedMetric = signal<WorkoutProfileMetric | null>(null);
  readonly repeatPasses = signal<Record<string, number>>({});
  private readonly displayRepeatPasses = computed(() => {
    const structure = this.structure();
    if (!structure || workoutProfileOccurrenceCount(structure) <= WORKOUT_PROFILE_EXPANSION_BUDGET) return {};
    const preferences = this.repeatPasses();
    return Object.fromEntries(structure.nodes.flatMap(node => {
      if (node.kind === 'step') return [];
      const requested = preferences[node.id];
      const pass = Number.isInteger(requested) && requested >= 1 && requested <= node.count ? requested : 1;
      return [[node.id, pass]];
    }));
  }, { equal: (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(id => a[id] === b[id]) });
  readonly metricLabels = computed(() => workoutProfileMetricLabels(this.structure()?.sport));
  readonly isStrength = computed(() => this.structure()?.sport === ActivityTypes.StrengthTraining);
  readonly model = computed(() => {
    if (!this.expanded() || !this.structure() || this.isStrength()) return null;
    try {
      // Only an actual displayed-pass change redraws content. Remembering a selected
      // pass must not dismiss the first tap's tooltip, including after count edits.
      return buildWorkoutProfile(this.structure(), this.unitSettings(), this.locale, this.displayRepeatPasses());
    }
    catch { return null; }
  });
  readonly metric = computed(() => this.model()?.metrics.includes(this.selectedMetric())
    ? this.selectedMetric() : this.model()?.metrics[0] ?? null);
  readonly selected = computed(() => this.model()?.occurrences.find(step => step.occurrenceKey === this.selectedKey()) ?? null);
  readonly steps = computed(() => this.model()?.occurrences.map(step => ({ ...step,
    changed: this.changedStepIds().includes(step.stepId) || this.changedStepIds().includes(step.repeatId),
    targetsText: step.targets.map(t => t.text).join(' · ') || 'No target prescribed' })) ?? []);
  readonly chartWidth = computed(() => Math.max(320, (this.model()?.occurrences.length ?? 0) * 46 + (this.metric() ? 96 : 16)));
  readonly summary = computed(() => {
    const targets = this.metric() ? `${this.metricLabels()[this.metric()]} target ranges.`
      : this.steps().some(step => step.targets.length) ? 'No finite target ranges to plot.' : 'No targets prescribed.';
    return `${this.model()?.occurrenceCount ?? 0} step occurrences. Equal widths show step order, not time or distance. ${targets} Use the step buttons for details.`;
  });

  private readonly theme = inject(RenderedThemeService);
  private readonly haptics = inject(AppHapticsService);
  private readonly locale = inject(LOCALE_ID);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly chartElement = viewChild<ElementRef<HTMLDivElement>>('chart');
  private readonly chartHost = new EChartsHostController({
    eChartsLoader: inject(EChartsLoaderService), logger: inject(LoggerService), logPrefix: '[WorkoutProfile]',
    deferUntilNearViewport: true,
    // Accepted selection owns feedback for both keyboard and chart clicks. Disable shared duplicate/raw pointer feedback.
    mobileTapFeedbackOptions: { clickFeedback: 'off', axisPointerFeedback: 'off', surfaceClickFeedback: false, surfaceDragFeedback: false },
  });
  private renderGeneration = 0;
  private renderedScene: { model: ReturnType<typeof buildWorkoutProfile>; metric: WorkoutProfileMetric | null;
    dark: boolean; changed: readonly string[]; context: string } | null = null;

  constructor() {
    effect(() => {
      this.contextKey();
      const initiallyExpanded = this.initiallyExpanded();
      untracked(() => { this.expanded.set(initiallyExpanded); this.selectedKey.set(null); this.selectedMetric.set(null); this.repeatPasses.set({}); });
    });
    afterRenderEffect(() => {
      const host = this.chartElement()?.nativeElement;
      const model = this.model();
      const metric = this.metric();
      const selectedKey = this.selectedKey();
      const changed = this.changedStepIds();
      const units = this.unitSettings();
      const dark = this.theme.darkTheme();
      const context = this.contextKey();
      const generation = ++this.renderGeneration;
      if (!host || !model) { this.chartHost.dispose(); this.renderedScene = null; return; }
      void this.chartHost.init(host, resolveEChartsThemeName(dark)).then(chart => {
        if (!chart || generation !== this.renderGeneration) return;
        chart.off('click', this.onChartClick);
        chart.on('click', this.onChartClick);
        const previous = this.renderedScene;
        // Keep the first tap's tooltip visible while updating selection. Only content/context changes invalidate it.
        if (!previous || previous.model !== model || previous.metric !== metric || previous.dark !== dark
          || previous.changed !== changed || previous.context !== context) this.chartHost.hideTooltip();
        this.chartHost.setOption(buildWorkoutProfileChartOption(model, metric, selectedKey, changed, dark,
          host.clientWidth, isEChartsMobileTooltipViewport(), units, this.locale), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
        this.chartHost.scheduleResize();
        this.renderedScene = { model, metric, dark, changed, context };
      });
    });
    inject(DestroyRef).onDestroy(() => { this.renderGeneration++; this.chartHost.dispose(); });
  }

  toggleExpanded(): void { this.expanded.update(value => !value); this.haptics.selection(); }

  selectMetric(metric: WorkoutProfileMetric): void {
    if (this.metric() === metric || !this.model()?.metrics.includes(metric)) return;
    this.selectedMetric.set(metric); this.haptics.selection();
  }

  selectStep(step: WorkoutProfileOccurrence): void {
    const canonical = this.model()?.occurrences.find(s => s.occurrenceKey === step.occurrenceKey);
    if (!canonical || this.selectedKey() === canonical.occurrenceKey) return;
    this.selectedKey.set(canonical.occurrenceKey);
    if (canonical.repeatId && this.repeatPasses()[canonical.repeatId] !== canonical.iteration) {
      this.repeatPasses.update(passes => ({ ...passes, [canonical.repeatId]: canonical.iteration }));
    }
    this.stepSelected.emit({ occurrenceKey: canonical.occurrenceKey, stepId: canonical.stepId, repeatId: canonical.repeatId, iteration: canonical.iteration });
    this.haptics.selection();
  }

  selectRepeatPass(id: string, pass: number): void {
    const repeat = this.model()?.repeats.find(r => r.id === id);
    if (!repeat || repeat.iteration === pass || !repeat.passes.includes(pass)) return;
    const selected = this.selected();
    this.repeatPasses.update(value => ({ ...value, [id]: pass }));
    if (selected?.repeatId === id) {
      const next = this.model()?.occurrences.find(s => s.stepId === selected.stepId && s.repeatId === id);
      if (next) {
        this.selectedKey.set(next.occurrenceKey);
        this.stepSelected.emit({ occurrenceKey: next.occurrenceKey, stepId: next.stepId, repeatId: next.repeatId, iteration: next.iteration });
      }
    }
    this.haptics.selection();
  }

  onStepKeydown(event: KeyboardEvent, index: number): void {
    const count = this.steps().length;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? Math.min(index + 1, count - 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
    if (next === null) return;
    event.preventDefault();
    this.selectStep(this.steps()[next]);
    this.element.nativeElement.querySelector<HTMLButtonElement>(`[data-profile-index="${next}"]`)?.focus();
  }

  private readonly onChartClick = (event: unknown): void => {
    if (!event || typeof event !== 'object' || !('data' in event) || !event.data || typeof event.data !== 'object'
      || !('occurrenceKey' in event.data) || typeof event.data.occurrenceKey !== 'string') return;
    const key = event.data.occurrenceKey;
    const step = this.model()?.occurrences.find(s => s.occurrenceKey === key);
    if (step) this.selectStep(step);
  };
}
