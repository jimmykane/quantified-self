import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
    PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1,
    assessPlannedWorkoutProviderMappingV1,
    isPlannedWorkoutProviderDeliveryEnabled,
} from '../../../../shared/planned-workout-providers';
import type { WorkoutStructureV1 } from '../../../../shared/planned-workout';
import canonicalRunningFixture from './fixtures/canonical-running-v1.json';
import expectedSuuntoFixture from './fixtures/suunto-running-v1.json';
import expectedWahooFixture from './fixtures/wahoo-running-v1.json';
import {
    ProviderWorkoutMappingError,
    createStableProviderExternalId,
} from './provider-mapping';
import { serializeSuuntoGuideJsonV1 } from './suunto-guide.serializer';
import { serializeWahooPlanJsonV1 } from './wahoo-plan.serializer';

const RUNNING_FIXTURE = canonicalRunningFixture as WorkoutStructureV1;

function oneStepStructure(overrides: Partial<WorkoutStructureV1['nodes'][number]> = {}): WorkoutStructureV1 {
    return {
        version: 1,
        sport: ActivityTypes.Cycling,
        nodes: [{
            kind: 'step',
            id: 'main',
            purpose: 'work',
            ending: { kind: 'time', seconds: 600 },
            targets: [],
            ...overrides,
        } as WorkoutStructureV1['nodes'][number]],
    };
}

describe('planned-workout provider proof fixtures', () => {
    it('keeps every provider delivery path disabled before sandbox evidence exists', () => {
        expect(Object.values(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1)).toHaveLength(4);
        expect(Object.values(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1).every(capability => (
            capability.deliveryEnabled === false
        ))).toBe(true);
        expect(isPlannedWorkoutProviderDeliveryEnabled('garmin')).toBe(false);
        expect(isPlannedWorkoutProviderDeliveryEnabled('coros')).toBe(false);
        expect(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1.wahoo.implementationState).toBe('fixture-only');
        expect(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1.suunto.implementationState).toBe('fixture-only');
    });

    it('does not invent Garmin or COROS mappings without current partner contracts', () => {
        expect(assessPlannedWorkoutProviderMappingV1('garmin', RUNNING_FIXTURE)).toMatchObject({
            level: 'unsupported',
            issues: [{ code: 'provider_contract_unavailable' }],
        });
        expect(assessPlannedWorkoutProviderMappingV1('coros', RUNNING_FIXTURE)).toMatchObject({
            level: 'unsupported',
            issues: [{ code: 'provider_contract_unavailable' }],
        });
    });

    it('matches the redacted Wahoo plan.json fixture exactly', () => {
        const result = serializeWahooPlanJsonV1(RUNNING_FIXTURE, {
            name: 'Fixture intervals',
            description: 'Redacted provider contract fixture.',
            location: 'outdoor',
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.issues).toEqual([]);
        expect(result.artifact).toEqual(expectedWahooFixture);
    });

    it('matches the redacted Suunto Guide fixture exactly', () => {
        const result = serializeSuuntoGuideJsonV1(RUNNING_FIXTURE, {
            name: 'Fixture intervals',
            description: 'Redacted provider contract fixture.',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'fixture-workout-001',
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.issues).toEqual([]);
        expect(result.artifact).toEqual(expectedSuuntoFixture);
    });

    it('maps Wahoo native relative FTP targets through the header', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'ftp',
            purpose: 'work',
            ending: { kind: 'kilojoules', kilojoules: 120 },
            targets: [{
                kind: 'power',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 105,
                reference: { kind: 'functional-threshold-power', watts: 300 },
            }],
        });
        const result = serializeWahooPlanJsonV1(structure, {
            name: 'FTP work',
            location: 'indoor',
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.artifact.header.ftp).toBe(300);
        expect(result.artifact.intervals[0]).toMatchObject({
            exit_trigger_type: 'kj2',
            exit_trigger_value: 120,
            targets: [{ type: 'ftp', low: 0.9, high: 1.05 }],
        });
    });

    it('requires explicit approval before Wahoo freezes a critical-power target', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'critical',
            purpose: 'work',
            ending: { kind: 'time', seconds: 300 },
            targets: [{
                kind: 'power',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 110,
                reference: { kind: 'critical-power', watts: 250 },
            }],
        });

        expect(() => serializeWahooPlanJsonV1(structure, {
            name: 'Critical power',
            location: 'indoor',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({
            code: 'degradation-confirmation-required',
        } satisfies Partial<ProviderWorkoutMappingError>));

        const approved = serializeWahooPlanJsonV1(structure, {
            name: 'Critical power',
            location: 'indoor',
            allowDegraded: true,
        });
        expect(approved.level).toBe('degraded');
        expect(approved.artifact.intervals[0].targets).toEqual([
            { type: 'watts', low: 225, high: 275 },
        ]);
    });

    it('freezes Suunto relative targets and converts cadence from rpm to hertz only with approval', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'cadence',
            purpose: 'work',
            ending: { kind: 'manual' },
            targets: [{
                kind: 'cadence',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 110,
                reference: { kind: 'preferred-cadence', rpm: 90 },
            }],
        });

        expect(() => serializeSuuntoGuideJsonV1(structure, {
            name: 'Cadence',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'cadence-workout',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const approved = serializeSuuntoGuideJsonV1(structure, {
            name: 'Cadence',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'cadence-workout',
            allowDegraded: true,
        });
        expect(approved.level).toBe('degraded');
        expect(approved.artifact.steps[0]).toMatchObject({
            type: 'fields',
            fields: [{ type: 'targetCadence', min: 1.35, max: 1.65 }],
            transitions: [{ condition: { type: 'manualLap' } }],
        });
    });

    it('rejects endings that cannot be truthfully mapped', () => {
        const repetitions = oneStepStructure({
            kind: 'step',
            id: 'strength',
            purpose: 'work',
            ending: { kind: 'repetitions', repetitions: 12 },
            targets: [],
        });

        expect(() => serializeWahooPlanJsonV1(repetitions, {
            name: 'Repetitions',
            location: 'indoor',
            allowDegraded: true,
        })).toThrow(expect.objectContaining({ code: 'unsupported' }));
        expect(() => serializeSuuntoGuideJsonV1(repetitions, {
            name: 'Repetitions',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'repetitions',
            allowDegraded: true,
        })).toThrow(expect.objectContaining({ code: 'unsupported' }));
    });

    it('creates stable opaque provider IDs within the strict Suunto limit', () => {
        const first = createStableProviderExternalId('suunto', 'internal-workout-id');
        expect(first).toBe(createStableProviderExternalId('suunto', 'internal-workout-id'));
        expect(first).not.toContain('internal-workout-id');
        expect(first.length).toBeLessThanOrEqual(64);
        expect(createStableProviderExternalId('wahoo', 'internal-workout-id')).not.toBe(first);
    });
});
