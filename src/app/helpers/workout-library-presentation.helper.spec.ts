import { ActivityTypes, DistanceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import { parseWorkoutLibraryItemV1 } from '@shared/workout-library';
import { projectStrengthWorkoutToV1 } from '@shared/strength-workout';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { filterWorkoutLibrary, presentWorkoutLibraryItem } from './workout-library-presentation.helper';

const run = parseWorkoutLibraryItemV1({ schemaVersion: 1, id: 'run', title: 'Easy RUN',
  structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: 'work',
    purpose: 'work', ending: { kind: 'distance', meters: 5000 }, targets: [], note: 'Relax the shoulders' }] },
  status: 'active', revision: 1, createdAtMs: 1, updatedAtMs: 1 });

describe('workout library presentation', () => {
  it('combines trimmed title search, exact sport and lifecycle without mutating the library', () => {
    const archived = { ...run, id: 'old', status: 'archived' as const };
    const cycling = { ...run, id: 'bike', structure: { ...run.structure, sport: ActivityTypes.Cycling } };
    const items = [run, archived, cycling];
    expect(filterWorkoutLibrary(items, '  RUN ', ActivityTypes.Running, 'active')).toEqual([run]);
    expect(filterWorkoutLibrary(items, '', null, 'archived')).toEqual([archived]);
    expect(filterWorkoutLibrary(items, '', null, 'all')).toEqual(items);
    expect(filterWorkoutLibrary(items, 'missing', null, 'all')).toEqual([]);
    expect(items).toHaveLength(3);
  });

  it('keeps interval notes and previews unsupported prescriptions without editing or degrading them', () => {
    const item = { ...run, structure: { ...run.structure, nodes: [{ ...run.structure.nodes[0],
      ending: { kind: 'kilojoules' as const, kilojoules: 500 } }] } } as typeof run;
    const before = JSON.stringify(item);
    const preview = presentWorkoutLibraryItem(item);
    expect(preview.editable).toBe(false);
    expect(preview.details[0]).toMatch(/500(?:\.0+)? kJ/i);
    expect(preview.details[0]).toContain('Relax the shoulders');
    expect(JSON.stringify(item)).toBe(before);
    const lapEnded = parseWorkoutLibraryItemV1({ ...run, structure: { ...run.structure,
      nodes: [{ ...run.structure.nodes[0], ending: { kind: 'manual' } }] } });
    expect(presentWorkoutLibraryItem(lapEnded).editable).toBe(true);
    expect(presentWorkoutLibraryItem(lapEnded).details[0]).toContain('Manual transition');
  });

  it('retains repeats and notes while displaying interval distances in kilometres or miles', () => {
    const item = parseWorkoutLibraryItemV1({ ...run, structure: { ...run.structure,
      nodes: [{ kind: 'repeat', id: 'repeat', count: 4, steps: [{ ...run.structure.nodes[0],
        ending: { kind: 'distance', meters: 5000, allowEarlyLap: true } }] }] } });
    const metric = presentWorkoutLibraryItem(item);
    const imperial = presentWorkoutLibraryItem(item, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }));
    expect(metric.details[0]).toContain('4× (');
    expect(metric.details[0]).toMatch(/5(?:\.0+)? km/i);
    expect(imperial.details[0]).toMatch(/3\.1\d* mi/i);
    expect(imperial.details[0]).toContain('Relax the shoulders');
    expect(imperial.details[0]).toContain('or Lap');
    expect(item.structure.nodes[0]).toMatchObject({ count: 4, steps: [{ ending: { kind: 'distance', meters: 5000, allowEarlyLap: true } }] });
  });

  it('shows every strength set, load and rest in account units with a compact summary', () => {
    const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Squat',
      sets: [1, 2, 3].map(index => ({ id: `set-${index}`, ending: { kind: 'repetitions' as const, repetitions: 5 },
        externalLoadKg: 80, restAfterSeconds: 90 })) }] };
    const item = { ...run, strength, structure: projectStrengthWorkoutToV1({ ...strength, workoutId: 'saved', revision: 1 }) };
    const metric = presentWorkoutLibraryItem(item);
    const imperial = presentWorkoutLibraryItem(item, normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds }));
    expect(metric.details).toHaveLength(3);
    expect(metric.summary).toHaveLength(2);
    expect(metric.details[2]).toContain('Squat · Set 3 · 5 reps');
    expect(metric.details[0]).toContain('80.0 kg');
    expect(metric.details[0]).toContain('Rest');
    expect(imperial.details[0]).toContain('176.4 lb');
    expect(imperial.details[0]).not.toContain('80.0 kg');
    expect(metric.editable).toBe(true);
  });
});
