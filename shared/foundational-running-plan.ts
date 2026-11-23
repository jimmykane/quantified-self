import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStepV1, WorkoutStructureV1 } from './planned-workout';
import type { PlanTemplate, TemplateSession } from './training-plan-templates';

// The training content in this file is adapted from the CC BY 4.0 work credited below.
const attribution = {
  title: 'Build-up a foundational running base',
  originalAuthor: 'Felix Gertz',
  sourceUrl: 'https://plans.tredict.com/en/plan/Buildup_a_foundational_running_base/zoySQCnLM',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: 'Quantified Self adapted the titles and coaching cues, converted the sessions into workout steps, and kept the original day spacing. Heart-rate and threshold-pace guidance is rounded and shown in step notes. Device target bands and example athlete values are omitted.',
  notice: 'This is an example plan for the Tredict training plans publishing feature.',
};

function step(id: string, seconds: number | null, note: string, purpose: WorkoutStepV1['purpose'] = 'work'): WorkoutStepV1 {
  return { kind: 'step', id, purpose, ending: seconds === null ? { kind: 'manual' } : { kind: 'time', seconds }, targets: [], note };
}
function session(day: number, title: string, ...nodes: WorkoutStructureV1['nodes']): TemplateSession {
  return { day, title, structure: { version: 1, sport: ActivityTypes.Running, nodes } };
}
function easy(seconds: number, percent: number, cue: string) {
  return step('run', seconds, cue + ' Aim for ' + percent + '% of your maximum heart rate.');
}
const openFinish = () => step('cooldown', null, 'Cool down at your own pace. Finish when ready.', 'cooldown');
const openRun = () => step('continue', null, 'Continue at an easy rhythm until you choose to finish.');
function repeats(count: number, fast: number, recover: number): WorkoutStructureV1['nodes'][number] {
  return { kind: 'repeat', id: 'intervals', count, steps: [
    step('stride', fast, 'Run fast with a smooth rhythm, below an all-out sprint.'),
    step('recover', recover, 'Jog slowly or walk between efforts.', 'recovery'),
  ] };
}
function warmup(seconds: number, percent: number) {
  return step('warmup', seconds, 'Start easily at about ' + percent + '% of your maximum heart rate.', 'warmup');
}
const openTenMinutes = () => step('cooldown', null, 'Cool down easily for about 10 minutes. Finish this step manually.', 'cooldown');

export const FOUNDATIONAL_RUNNING_PLAN: PlanTemplate = {
  id: 'tredict-running-base', version: 1, source: 'catalog', attribution,
  name: attribution.title, author: attribution.originalAuthor, sport: ActivityTypes.Running, days: 28,
  description: 'For runners returning after a break. Use a heart-rate monitor for the easy efforts. Four weeks progress from a 20-minute run to a 90-minute outing, with short strides and a threshold-pace session.',
  phases: [
    { id: 'week-1', name: 'Find an easy rhythm', start: 0, end: 6, description: 'Keep the first week easy as you return to running.' },
    { id: 'week-2', name: 'Introduce strides', start: 7, end: 13, description: 'Keep a steady running rhythm and introduce short faster efforts.' },
    { id: 'week-3', name: 'Build running strength', start: 14, end: 20, description: 'Two sessions include strides alongside longer easy running.' },
    { id: 'week-4', name: 'Extend the long run', start: 21, end: 27, description: 'Finish with short intervals, a threshold effort and the longest outing.' },
  ],
  rest: [], // The source leaves the other dates open.
  sessions: [
    session(0, 'Ease back into running', easy(1200, 68, 'Run very gently.')),
    session(2, 'Settle into an easy rhythm', easy(1800, 68, 'Keep the pace relaxed.'), openFinish()),
    session(4, 'A slightly quicker easy run', easy(1800, 75, 'Stay comfortable as you pick up the pace.')),
    session(6, 'First longer outing', easy(3000, 72, 'Keep the longer run easy. Extend it only if comfortable.'), openFinish()),
    session(8, 'Practice steady pacing', easy(1800, 67, 'Hold an even rhythm.'), openRun()),
    session(10, 'Eight short strides', warmup(1200, 70), repeats(8, 20, 20), openTenMinutes()),
    session(12, 'Fifty minutes on an easy route', easy(3000, 68, 'Keep effort even over hills.'), openRun()),
    session(14, 'Strides followed by easy running', warmup(1800, 70), repeats(8, 20, 20),
      step('easy', 1200, 'Return to very easy running for 20 minutes.'), openFinish()),
    session(16, 'Comfortable endurance run', easy(3000, 68, 'Settle into an easy pace for 50 minutes.'), openRun()),
    session(18, 'Long aerobic run with strides', warmup(1800, 70), repeats(8, 20, 20),
      step('easy', 1800, 'Resume very easy running for 30 minutes.'), openFinish()),
    session(20, 'Relaxed short run', easy(1800, 74, 'Choose a relaxed pace after the longer sessions.'), openRun()),
    session(22, 'Six short efforts', warmup(1200, 66), repeats(6, 40, 30), openTenMinutes()),
    session(24, 'Five minutes at threshold', easy(2400, 67, 'Start easily.'),
      step('transition', null, 'Continue around 67% of your maximum heart rate until ready for the faster step.'),
      step('threshold', 300, 'Run at your functional threshold pace (100%).'),
      step('settle', 600, 'Ease back to 72% of your maximum heart rate.'), openFinish()),
    session(27, 'Ninety-minute long run', step('run', 5400, 'Maintain the comfortable rhythm you have practiced.'), openRun()),
  ],
};
