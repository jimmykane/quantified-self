import { TRAINING_PROGRAMS, type TrainingProgram } from './training-plan-programs';
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
  originalAuthor: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  changes: string;
  notice: string;
  privateCopy?: true;
}
export interface PlanTemplate {
  attribution?: PlanAttribution;
  scheduleMode?: 'fixed' | 'flexible';
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
function timed(id: string, minutes: number, note: string, purpose: WorkoutStepV1['purpose'] = 'work'): WorkoutStepV1 {
  return { kind: 'step', id, purpose, ending: { kind: 'time', seconds: minutes * 60 }, targets: [], note };
}
function buildProgram(program: TrainingProgram): PlanTemplate {
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
export const TRAINING_PLAN_CATALOG = [...TRAINING_PROGRAMS.map(buildProgram), FOUNDATIONAL_RUNNING_PLAN];

export function templateScheduleMode(template: Pick<PlanTemplate, 'source' | 'scheduleMode'>): 'fixed' | 'flexible' {
  return template.source === 'private' ? 'fixed' : template.scheduleMode ?? 'flexible';
}
export function scheduleTemplate(template: PlanTemplate, options: TemplateScheduleOptions) {
  const date = normalizeTrainingLocalDate(options.date);
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  if (!Number.isInteger(options.longDay) || options.longDay < 0 || options.longDay > 6) throw Error('Choose a valid long-session weekday.');
  const flexibleDays = templateScheduleMode(template) === 'flexible';
  if (flexibleDays && options.anchor === 'finish' && weekday !== options.longDay) throw Error('Choose the event weekday as the long-session day.');
  const lead = flexibleDays ? (options.longDay + 1 - weekday + 7) % 7 : 0;
  const start = addDaysToTrainingLocalDate(date, options.anchor === 'finish' ? 1 - template.days : lead);
  const at = (offset: number) => addDaysToTrainingLocalDate(start, offset);
  return { start, end: at(template.days - 1), sessions: template.sessions.map(({ day, ...session }) => ({
      ...session, localDate: at(flexibleDays && options.pattern === 'early' && day % 7 === 1 ? day - 1 : day) })),
    restDays: template.rest.map(at), phases: { version: 1 as const, items: template.phases.map(({ start, end, ...phase }) =>
      ({ ...phase, startLocalDate: at(start), endLocalDate: at(end) })) } };
}
