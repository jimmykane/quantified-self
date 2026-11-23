import { FOUNDATIONAL_RUNNING_PLAN } from './foundational-running-plan';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStepV1, WorkoutStructureV1 } from './planned-workout';
import type { StrengthWorkoutDraftV1 } from './strength-workout';
import { addDaysToTrainingLocalDate, normalizeTrainingLocalDate, type TrainingPlanColor } from './training-plans';

export interface TemplateSession {
  day: number;
  title: string;
  structure: WorkoutStructureV1;
  strength?: StrengthWorkoutDraftV1;
}
export interface PlanAttribution {
  title: string;
  creator: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  changes: string;
  notice: string;
  privateCopy?: true;
}
export interface PlanTemplate {
  attribution?: PlanAttribution;
  id: string;
  version: number;
  source: 'catalog' | 'private';
  name: string;
  description: string;
  author: string;
  sport: string;
  days: number;
  sessions: TemplateSession[];
  rest: number[];
  phases: { id: string; name: string; start: number; end: number; description?: string; color?: TrainingPlanColor }[];
}
export interface TemplateScheduleOptions {
  anchor: 'start' | 'finish';
  date: string;
  /** Calendar weekday of the last session of a catalog week (Sunday = 0). */
  longDay: number;
  pattern: 'standard' | 'early';
}
type Program = {
  id: string; version: number; name: string; description: string; cycle?: boolean; fourth?: boolean;
  easy: number; steady: number; long: number[]; finishMeters?: number;
};
const programs: Program[] = [
  { id: 'first-run', version: 1, name: 'First 30-Minute Run', description: 'For walkers comfortable with a 30-minute walk. Build toward running continuously at a conversational effort.',
    easy: 20, steady: 20, long: [20,22,24,20,25,26,24,28,30] },
  { id: 'first-ride', version: 1, name: 'First 50 km Ride', description: 'For riders comfortable on a bike for 30 minutes. Build toward a first 50 km outing.',
    cycle: true, easy: 25, steady: 30, long: [35,45,55,40,65,80,95,100], finishMeters: 50000 },
  { id: '5k', version: 1, name: '5K Race', description: 'For runners already comfortable running continuously for 25 minutes, three days per week.',
    easy: 20, steady: 25, long: [30,32,35,28,38,40,32,30], finishMeters: 5000 },
  { id: '10k', version: 1, name: '10K Race', description: 'For runners already running three days a week with a comfortable 40-minute long run.',
    easy: 25, steady: 30, long: [40,42,46,38,50,55,46,60,45,55], finishMeters: 10000 },
  { id: 'half', version: 1, name: 'Half Marathon', description: 'For regular runners with a comfortable hour-long run and three running days each week.',
    easy: 35, steady: 40, long: [60,65,70,55,75,80,85,65,90,100,75,100], finishMeters: 21097.5 },
  { id: 'marathon', version: 1, name: 'Marathon', description: 'For experienced runners already running four days weekly, including a comfortable 90-minute long run.',
    fourth: true, easy: 40, steady: 45, long: [90,95,105,85,110,115,125,95,135,140,110,145,155,120,165,125,85,180], finishMeters: 42195 },
  { id: '100k', version: 1, name: '100 km Cycling Event', description: 'For riders already riding three days weekly, including a comfortable 90-minute ride.',
    cycle: true, easy: 45, steady: 50, long: [90,100,110,85,120,135,105,145,160,180,120,180], finishMeters: 100000 },
];
function timed(id: string, minutes: number, note: string, purpose: WorkoutStepV1['purpose'] = 'work'): WorkoutStepV1 {
  return { kind: 'step', id, purpose, ending: { kind: 'time', seconds: minutes * 60 }, targets: [], note };
}
function buildProgram(program: Program): PlanTemplate {
  const { long } = program;
  const sport = program.cycle ? ActivityTypes.Cycling : ActivityTypes.Running;
  const sessions: TemplateSession[] = [];
  const rest: number[] = [];
  const add = (day: number, title: string, nodes: WorkoutStructureV1['nodes']) =>
    sessions.push({ day, title, structure: { version: 1, sport, nodes } });
  long.forEach((minutes, week) => {
    const first = week * 7;
    const raceWeek = week === long.length - 1;
    const light = week > 0 && minutes < long[week - 1];
    const short = raceWeek || light ? 0.75 : 1;
    if (program.id === 'first-run') {
      const run = [1,2,3,3,5,8,10,13,15][week];
      const passes = [6,5,4,4,3,2,2,2,2][week];
      for (const day of [1,3,6]) {
        if (raceWeek && day === 6) add(first + day, 'Continuous easy run', [timed('run', 30, 'Run at a comfortable conversational effort.')]);
        else add(first + day, 'Easy run and walk', [timed('warmup', 5, 'Walk briskly.', 'warmup'),
          { kind: 'repeat', id: 'run-walk', count: passes, steps: [timed('run', run, 'Run comfortably.'), timed('walk', 1, 'Walk and recover.', 'recovery')] },
          timed('cooldown', 5, 'Walk easily.', 'cooldown')]);
      }
    } else {
      add(first + 1, program.cycle ? 'Easy ride' : 'Easy run', [timed('easy', Math.round(program.easy * short), 'Keep the effort conversational.')]);
      const duration = Math.round(program.steady * short);
      add(first + 3, 'Steady aerobic session', [timed('warmup', 5, 'Start easily.', 'warmup'),
        timed('steady', duration - 10, 'Settle into a controlled, steady effort.'), timed('cooldown', 5, 'Finish easily.', 'cooldown')]);
      if (program.fourth) add(first + 5, 'Short easy run', [timed('easy', Math.round(25 * short), 'Run gently at conversational effort.')]);
      if (raceWeek && program.finishMeters) add(first + 6, program.name, [{ kind: 'step', id: 'event', purpose: 'work',
        ending: { kind: 'distance', meters: program.finishMeters }, targets: [], note: 'Start comfortably and settle into a sustainable effort.' }]);
      else add(first + 6, program.cycle ? 'Long ride' : 'Long run', [timed('long', minutes, 'Keep a relaxed, sustainable effort.')]);
    }
    rest.push(first + 2, first + 4);
  });
  const boundary = Math.floor(long.length / 2) * 7;
  return { id: program.id, version: program.version, source: 'catalog', name: program.name, description: program.description,
    author: 'Quantified Self', sport, days: long.length * 7, sessions, rest,
    phases: [{ id: 'base', name: 'Base', start: 0, end: boundary - 1 },
      { id: 'build', name: 'Build', start: boundary, end: long.length * 7 - 8 },
      { id: 'finish', name: 'Event week', start: long.length * 7 - 7, end: long.length * 7 - 1 }] };
}
export const TRAINING_PLAN_CATALOG = [...programs.map(buildProgram), FOUNDATIONAL_RUNNING_PLAN];

export function hasFlexibleTrainingDays(template: PlanTemplate): boolean {
  return template.source === 'catalog' && !template.attribution;
}
export function scheduleTemplate(template: PlanTemplate, options: TemplateScheduleOptions) {
  const date = normalizeTrainingLocalDate(options.date);
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  if (!Number.isInteger(options.longDay) || options.longDay < 0 || options.longDay > 6) throw Error('Choose a valid long-session weekday.');
  const flexibleDays = hasFlexibleTrainingDays(template);
  if (flexibleDays && options.anchor === 'finish' && weekday !== options.longDay) throw Error('Choose the event weekday as the long-session day.');
  const lead = flexibleDays ? (options.longDay + 1 - weekday + 7) % 7 : 0;
  const start = addDaysToTrainingLocalDate(date, options.anchor === 'finish' ? 1 - template.days : lead);
  const at = (offset: number) => addDaysToTrainingLocalDate(start, offset);
  return { start, end: at(template.days - 1), sessions: template.sessions.map(({ day, ...session }) => ({
      ...session, localDate: at(flexibleDays && options.pattern === 'early' && day % 7 === 1 ? day - 1 : day) })),
    restDays: template.rest.map(at), phases: { version: 1 as const, items: template.phases.map(({ start, end, ...phase }) =>
      ({ ...phase, startLocalDate: at(start), endLocalDate: at(end) })) } };
}
