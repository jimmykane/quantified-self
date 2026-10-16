import type { WorkoutStructureV1 } from '../../../../shared/planned-workout';
import type { SuuntoGuideConditionV1, SuuntoGuideFieldsStepV1, SuuntoGuideStepV1 } from './suunto-guide.serializer';

export function hasSuuntoTimedRest(structure: WorkoutStructureV1): boolean {
  return structure.nodes.some(node => (node.kind === 'step' ? [node] : node.steps)
    .some(step => step.purpose === 'rest' && step.ending.kind === 'time'));
}

function matchesDuration(condition: SuuntoGuideConditionV1, seconds: number): boolean {
  return condition.type === 'stepDuration' ? condition.value === seconds
    : condition.type === 'or' && condition.conditions.some(child => matchesDuration(child, seconds));
}

/** Only decorate the frozen serializer's canonical Rest phase, before headings
 * or optional fields are allocated. Authored notes never select a phase. Keep
 * transitions and recorded laps intact; the watch owns the standard alert pattern. */
export function addSuuntoRestCountdownAlerts(steps: SuuntoGuideStepV1[]): SuuntoGuideStepV1[] {
  const decorate = <T extends SuuntoGuideFieldsStepV1>(screen: T): T => {
    if (screen.title !== 'Rest') return screen;
    const timer = screen.fields.find(field => field.type === 'stepDurationCountdown');
    if (!timer || timer.type !== 'stepDurationCountdown'
      || !screen.transitions?.some(transition => matchesDuration(transition.condition, timer.value))) return screen;
    return { ...screen, alerts: [{ type: 'default', condition: { type: 'stepDuration', value: timer.value },
      countdown: { type: 'standard' } }] };
  };
  return steps.map(step => step.type === 'repeat' ? { ...step, steps: step.steps.map(decorate) } : decorate(step));
}
