import { WorkoutStructureValidationError, type WorkoutStructureValidationIssue } from '../../../shared/planned-workout';
import { StrengthWorkoutValidationError } from '../../../shared/strength-workout';

type IssueCode = WorkoutStructureValidationIssue['code'];
export interface DayWorkoutValidationDiagnostic { code: IssueCode; field: string; reason: string }

const fallbackReasons: Record<IssueCode, string> = {
  invalid_type: 'Use the type required by the prescription schema.',
  invalid_value: 'Use a valid value within the prescription limits.',
  unsupported_version: 'Use prescription version 1.',
  unknown_field: 'Remove fields not in the requested schema.',
  unknown_discriminant: 'Choose a value allowed by the prescription schema.',
  duplicate_id: 'Use unique IDs throughout the prescription.',
  limit_exceeded: 'Keep this field within the prescription limits.',
  inverted_range: 'The maximum must be greater than or equal to the minimum.',
};
// Only exact server-authored rules may cross into logs or the correction prompt.
// Never forward arbitrary error messages: duplicate-ID errors contain authored IDs.
const safeReasons = new Set([
  'Expected an object.', 'Expected an array.', 'Expected a non-empty array.',
  'Expected a non-empty array of steps.', 'Expected a finite positive number.',
  'Expected a finite non-negative number.', 'Expected a positive integer.',
  'Expected ^[A-Za-z0-9][A-Za-z0-9_-]*$ and at most 128 characters.',
  'Expected a non-empty string of at most 500 characters.',
  'Early Lap permission must be a boolean.', 'Choose Garmin power averaging of 3, 10 or 30 seconds.',
  'Garmin zones require a power target.', 'Pace targets require positive speed bounds.',
  'Target kinds must be unique within a step.', 'Pool length is only valid for pool swimming.',
  'Pool length must be between 1 and 1000 metres.',
  'Garmin power zones currently support Running and Cycling only.',
  'Expected step. Nested repeats are not supported.', 'Expected step or repeat.',
  'Expected a supported canonical activity type or alias.',
  'Workout structures may contain at most 100 nodes including repeated steps.',
  'A step may contain at most 2 targets.', 'Must be at most 100.', 'Must be at most 7.',
  'Expected a safe ID of at most 64 characters.', 'Expected 1 to 50 ordered exercises.',
  'Expected 1 to 50 ordered sets.', 'Expected 1 to 80 characters.',
  'Expected an integer from 1 to 1000.', 'Expected an integer from 1 to 86400.',
  'Expected a finite value from 0 to 1000.', 'Not valid for repetitions.',
  'Not valid for a timed hold.', 'Expected repetitions or time.',
  'The V1 projection cannot exceed 100 nodes.',
]);
const safeFields = new Set([
  'version', 'sport', 'poolLength', 'meters', 'presentation', 'nodes', 'steps', 'id', 'kind', 'purpose',
  'ending', 'seconds', 'kilojoules', 'repetitions', 'allowEarlyLap', 'targets', 'note', 'count', 'mode',
  'minimumPercent', 'maximumPercent', 'reference', 'minimumBpm', 'maximumBpm', 'bpm',
  'minimumWatts', 'maximumWatts', 'watts', 'minimumMetersPerSecond', 'maximumMetersPerSecond',
  'metersPerSecond', 'minimumRpm', 'maximumRpm', 'rpm', 'zone', 'garminPowerAveragingSeconds',
  'exercises', 'sets', 'name', 'externalLoadKg', 'restAfterSeconds',
]);

function safeField(path: string, root: 'structure' | 'strength'): string {
  const fields: string[] = [];
  // Parser paths can include arbitrary unknown property names. Keep only a known
  // prefix and normalize array positions; never include IDs, unknown keys or values.
  if (path.length <= 512 && path.startsWith('$.')) {
    for (const part of path.slice(2).split('.').slice(0, 10)) {
      const match = /^([A-Za-z]+)(?:\[\d{1,6}\])?$/.exec(part);
      if (!match || !safeFields.has(match[1])) break;
      fields.push(match[1] + (part.includes('[') ? '[]' : ''));
    }
  }
  return `$.${root}${fields.length ? '.' + fields.join('.') : ''}`;
}

export function dayWorkoutValidationDiagnostics(error: unknown): DayWorkoutValidationDiagnostic[] {
  let issues: WorkoutStructureValidationIssue[], root: 'structure' | 'strength';
  if (error instanceof WorkoutStructureValidationError) { issues = error.issues; root = 'structure'; }
  else if (error instanceof StrengthWorkoutValidationError) {
    const message = error.message.slice(error.path.length + 2);
    issues = [{ path: error.path, message,
      code: message === 'Unknown field.' ? 'unknown_field' : message === 'Duplicate ID.' ? 'duplicate_id' : 'invalid_value' }];
    root = 'strength';
  } else return [];
  const result: DayWorkoutValidationDiagnostic[] = [];
  const seen = new Set<string>();
  for (const issue of issues.slice(0, 20)) {
    if (!Object.prototype.hasOwnProperty.call(fallbackReasons, issue.code)) continue;
    const diagnostic = { code: issue.code, field: safeField(issue.path, root),
      reason: safeReasons.has(issue.message) ? issue.message : fallbackReasons[issue.code] };
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key); result.push(diagnostic);
    if (result.length === 5) break;
  }
  return result;
}
