import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, NgZone, computed, effect, inject, input, signal } from '@angular/core';
import { MaterialModule } from '../../modules/material.module';

const DEFAULT_AI_INSIGHTS_LOADING_STEPS = [
  'Parsing your prompt',
  'Crunching event stats',
  'Checking saved unit preferences',
  'Shaping the chart',
  'Drafting the summary',
] as const;

const AI_INSIGHTS_LOADING_STEP_DELAY_MS = 1450;
const AI_INSIGHTS_LOADING_COMPACT_STEP_DELAY_MS = 1100;
const DEFAULT_SUMMARY_SKELETON_ITEMS = [0, 1, 2, 3] as const;
const DEFAULT_CHART_SKELETON_BARS = [0, 1, 2, 3, 4, 5] as const;

function resolveLoadingSteps(steps: readonly string[]): readonly string[] {
  const cleanedSteps = steps
    .map(step => step.trim())
    .filter(step => step.length > 0);
  return cleanedSteps.length > 0 ? cleanedSteps : DEFAULT_AI_INSIGHTS_LOADING_STEPS;
}

@Component({
  selector: 'app-ai-insights-loading-state',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
  ],
  templateUrl: './ai-insights-loading-state.component.html',
  styleUrls: ['./ai-insights-loading-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsLoadingStateComponent {
  private readonly ngZone = inject(NgZone);

  readonly eyebrow = input('Crunching data');
  readonly title = input.required<string>();
  readonly copy = input<string | null>(null);
  readonly steps = input<readonly string[]>(DEFAULT_AI_INSIGHTS_LOADING_STEPS);
  readonly compact = input(false);
  readonly summarySkeletonItems = DEFAULT_SUMMARY_SKELETON_ITEMS;
  readonly chartSkeletonBars = DEFAULT_CHART_SKELETON_BARS;

  readonly activeStepIndex = signal(0);
  readonly resolvedSteps = computed(() => resolveLoadingSteps(this.steps()));
  readonly activeStep = computed(() => {
    const steps = this.resolvedSteps();
    return steps[Math.min(this.activeStepIndex(), steps.length - 1)] ?? '';
  });
  readonly progressLabel = computed(() => {
    const totalSteps = this.resolvedSteps().length;
    const currentStep = Math.min(this.activeStepIndex() + 1, totalSteps);
    return `${currentStep}/${totalSteps}`;
  });
  readonly rollerTransform = computed(() => `translateY(-${this.activeStepIndex() * 100}%)`);

  private readonly stepAnimation = effect((onCleanup) => {
    const steps = this.resolvedSteps();
    const stepDelay = this.compact()
      ? AI_INSIGHTS_LOADING_COMPACT_STEP_DELAY_MS
      : AI_INSIGHTS_LOADING_STEP_DELAY_MS;

    this.activeStepIndex.set(0);

    if (steps.length < 2) {
      return;
    }

    let activeStepIndex = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (): void => {
      if (activeStepIndex >= steps.length - 1) {
        return;
      }

      this.ngZone.runOutsideAngular(() => {
        timer = setTimeout(() => {
          activeStepIndex += 1;
          this.activeStepIndex.set(activeStepIndex);
          schedule();
        }, stepDelay);
      });
    };

    schedule();

    onCleanup(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    });
  });
}
