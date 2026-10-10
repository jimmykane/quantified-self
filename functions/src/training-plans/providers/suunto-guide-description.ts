import { DataWeight, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { formatWorkoutEndingV1, formatWorkoutStepV1, parseWorkoutStructureV1 } from '../../../../shared/planned-workout';
import { parseStrengthWorkoutDetailsV1, type StrengthWorkoutDetailsV1 } from '../../../../shared/strength-workout';
import { normalizeUserUnitSettings, resolveUnitAwareDisplayStat } from '../../../../shared/unit-aware-display';
import type { SuuntoGuideJsonV1, SuuntoGuideStepV1 } from './suunto-guide.serializer';

// Keep authored text literal, rather than executable HTML or authored Markdown.
function literal(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&');
}

/** Full definition-order preview. Native repeats are grouped, never expanded. */
export function suuntoGuideDescription(structureValue: unknown, title: string,
  units?: UserUnitSettingsInterface, strength?: StrengthWorkoutDetailsV1 | null): string {
  const structure = parseWorkoutStructureV1(structureValue);
  const settings = normalizeUserUnitSettings(units);
  const lines = [`## ${literal(title)}`, '', literal(structure.sport), '', '### Workout steps', ''];
  if (strength) {
    const details = parseStrengthWorkoutDetailsV1(strength);
    for (const exercise of details.exercises) {
      lines.push(`**${literal(exercise.name)}**`, '');
      exercise.sets.forEach((set, index) => {
        const load = set.externalLoadKg === undefined ? ''
          : ` · ${resolveUnitAwareDisplayStat(new DataWeight(set.externalLoadKg), settings)!.text}`;
        lines.push(`- Set ${index + 1} · ${literal(formatWorkoutEndingV1(set.ending, settings) + load)}`);
        if (set.ending.kind === 'repetitions') lines.push('  - Press Lap to finish this set.');
        if (set.restAfterSeconds !== undefined) lines.push(`- Rest · ${literal(formatWorkoutEndingV1({ kind: 'time', seconds: set.restAfterSeconds }, settings))}`);
      });
      lines.push('');
    }
  } else {
    for (const node of structure.nodes) {
      const repeat = node.kind === 'repeat';
      if (repeat) lines.push(`**Repeat ${node.count} times**`, '');
      for (const step of repeat ? node.steps : [node]) {
        const text = step.ending.kind === 'manual'
          ? formatWorkoutStepV1(step, settings, 'en-US', structure.sport).replace('Manual transition', 'Press Lap to finish')
          : formatWorkoutStepV1(step, settings, 'en-US', structure.sport);
        lines.push(`- ${literal(text)}`);
        if (step.note) lines.push(...step.note.split(/\r?\n/).map(line => `  ${literal(line)}  `));
      }
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

/** Include observed notification enrichment in the existing readback budget. */
function enriched(steps: SuuntoGuideStepV1[]): unknown[] {
  return steps.map(step => step.type === 'repeat' ? { ...step, steps: enriched(step.steps) }
    : { ...step, ...(step.notification ? { notification: { ...step.notification, type: 'default' } } : {}) });
}

/** Never shorten instructions, alter watch screens or increase archive memory limits. */
export function withSuuntoGuideDescription(artifact: SuuntoGuideJsonV1, text: string): SuuntoGuideJsonV1 {
  const candidate = { ...artifact, richText: text };
  if (!text.trim() || Array.from(text).length > 100_000
    || Buffer.byteLength(JSON.stringify({ ...candidate, steps: enriched(candidate.steps) }), 'utf8') > 256 * 1024) {
    return artifact; // The existing short description remains the documented fallback.
  }
  return candidate;
}
