import type { WorkoutStructureV1 } from '../../../shared/planned-workout';

/** Narrow contradiction checks, never a text-to-recipe parser, source proof or mutation authority.
 * Only explicit timed-effort literals, labelled HR ranges and a flat, labelled race distance qualify.
 * Notes, qualitative intensity, unitless numbers and missing source information cannot supply a recipe.
 */
export function findTrainingPrescriptionConflict(title: string, structure: WorkoutStructureV1): string | null {
  // Context/negation is ambiguous, not an instruction to override the athlete's structured recipe.
  if (/\b(?:not|no|avoid|without|previously|previous|example|prep|preparation|training for)\b/i.test(title)) return null;
  const timed = [...title.matchAll(/\b(\d{1,3})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|seconds?|secs?)\b/gi)];
  if (timed.length) {
    const expected = new Map<number, number>();
    for (const match of timed) {
      const count = Number(match[1]);
      const seconds = Number(match[2]) * (/^m/i.test(match[3]) ? 60 : 1);
      if (count < 1 || count > 100 || !Number.isFinite(seconds) || seconds <= 0) continue;
      expected.set(seconds, (expected.get(seconds) ?? 0) + count);
    }
    for (const [seconds, count] of expected) {
      let actual = 0;
      for (const node of structure.nodes) {
        const steps = node.kind === 'step' ? [node] : node.steps;
        for (const step of steps) {
          if ((step.purpose === 'work' || step.purpose === 'other') && step.ending.kind === 'time'
            && Math.abs(step.ending.seconds - seconds) <= Math.max(1e-9, seconds * 1e-9)) {
            actual += node.kind === 'repeat' ? node.count : 1;
          }
        }
      }
      if (actual !== count) return 'Prescription conflict: the title specifies timed efforts that the structured work steps do not contain. Compare the source and correct the recipe or clarify the title; do not retry the same preview or guess recovery/targets.';
    }
  }
  // A labelled numeric HR prescription cannot be represented solely by a title. Do not infer
  // assignment to particular steps or convert relative ranges here; the full recipe still needs review.
  if (/\b(?:HR|heart rate)\s*[:=]?\s*\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?\s*bpm\b/i.test(title)
    && !structure.nodes.some(node => (node.kind === 'step' ? [node] : node.steps)
      .some(step => step.targets.some(target => target.kind === 'heart-rate')))) {
    return 'Prescription conflict: the title specifies a numeric HR range but the recipe has no HR target. Compare the source and encode the assigned target or clarify the title; do not invent target values or step assignments.';
  }
  const race = title.match(/^\s*(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|k|mi|miles?)\s+race\b(?!\s*(?:prep|training))/i);
  const step = structure.nodes.length === 1 ? structure.nodes[0] : null;
  if (race && step?.kind === 'step' && step.ending.kind === 'distance') {
    const meters = Number(race[1]) * (/^(?:mi|mile)/i.test(race[2]) ? 1609.344 : 1000);
    // Accept normal rounded equivalent-mile labels, not a change in physical units.
    if (meters > 0 && Number.isFinite(meters)
      && Math.abs(step.ending.meters - meters) > Math.max(1, meters * 0.001)) {
      return 'Prescription conflict: the explicit race distance differs from the single structured distance step. Check source units and correct the recipe or clarify the title before requesting approval.';
    }
  }
  return null;
}
