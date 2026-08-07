import { describe, expect, it } from 'vitest';
import { SECRET_PARAMS } from './secrets';
import {
  createGcloudFunctionDeployArgs,
  createFunctionSecretMigrationPlan,
  parseDeployedSecretMigrationArgs,
} from './deployed-secret-env-migration';

describe('deployed Function secret environment migration', () => {
  it('plans an atomic plaintext removal and exact secret update for bound endpoints', () => {
    const plan = createFunctionSecretMigrationPlan([
      {
        name: 'boundFunction',
        environment: 'GEN_2',
        sourceBucket: 'deployments',
        sourceObject: 'source.zip',
        environmentVariableNames: [
          'FIREBASE_CONFIG',
          'MAPBOX_ACCESS_TOKEN',
          'SENTRY_AUTH_TOKEN',
        ],
        secretEnvironmentVariableNames: ['GEMINI_API_KEY'],
      },
      {
        name: 'publicFunction',
        environment: 'GEN_1',
        sourceBucket: 'deployments',
        sourceObject: 'source.zip',
        environmentVariableNames: ['STRIPE_SECRET_KEY'],
        secretEnvironmentVariableNames: [],
      },
    ], [
      'boundFunction',
      'missingFunction',
      'publicFunction',
    ], {
      boundFunction: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
    });

    expect(plan.actions).toEqual([{
      name: 'boundFunction',
      environment: 'GEN_2',
      sourceBucket: 'deployments',
      sourceObject: 'source.zip',
      removeEnvironmentVariables: ['MAPBOX_ACCESS_TOKEN', 'SENTRY_AUTH_TOKEN'],
      removeSecrets: ['GEMINI_API_KEY'],
      updateSecrets: ['MAPBOX_ACCESS_TOKEN'],
    }]);
    expect(plan.missingDeployedFunctions).toEqual(['missingFunction']);
    expect(plan.unusableSourceFunctions).toEqual([]);
    expect(plan.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('boundFunction: legacy plaintext bindings'),
      expect.stringContaining('boundFunction: expected secrets'),
      expect.stringContaining('publicFunction: legacy plaintext bindings'),
    ]));
  });

  it('pins updates to the exact deployed source archive', () => {
    expect(createGcloudFunctionDeployArgs({
      name: 'boundFunction',
      environment: 'GEN_2',
      sourceBucket: 'deployments',
      sourceObject: 'source.zip',
      removeEnvironmentVariables: ['MAPBOX_ACCESS_TOKEN'],
      removeSecrets: [],
      updateSecrets: ['MAPBOX_ACCESS_TOKEN'],
    }, 'quantified-self-io', 'europe-west2')).toEqual([
      'functions',
      'deploy',
      'boundFunction',
      '--project=quantified-self-io',
      '--region=europe-west2',
      '--source=gs://deployments/source.zip',
      '--quiet',
      '--gen2',
      '--remove-env-vars=MAPBOX_ACCESS_TOKEN',
      '--update-secrets=MAPBOX_ACCESS_TOKEN=MAPBOX_ACCESS_TOKEN:latest',
    ]);
  });

  it('reports unmanaged deployed endpoints without mutating clean endpoints', () => {
    const plan = createFunctionSecretMigrationPlan([
      {
        name: 'boundFunction',
        environment: 'GEN_2',
        sourceBucket: 'deployments',
        sourceObject: 'source.zip',
        environmentVariableNames: ['FIREBASE_CONFIG'],
        secretEnvironmentVariableNames: ['MAPBOX_ACCESS_TOKEN'],
      },
      {
        name: 'staleFunction',
        environment: 'GEN_2',
        sourceBucket: 'deployments',
        sourceObject: 'source.zip',
        environmentVariableNames: [],
        secretEnvironmentVariableNames: [],
      },
    ], ['boundFunction'], {
      boundFunction: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
    });

    expect(plan.actions).toEqual([]);
    expect(plan.violations).toEqual([]);
    expect(plan.unmanagedDeployedFunctions).toEqual(['staleFunction']);
    expect(plan.unusableSourceFunctions).toEqual([]);
  });

  it('refuses unsafe apply arguments and defaults to a dry run', () => {
    expect(parseDeployedSecretMigrationArgs([
      '--project=quantified-self-io',
      '--region=europe-west2',
    ])).toEqual({
      projectId: 'quantified-self-io',
      region: 'europe-west2',
      apply: false,
      confirmProject: undefined,
      requireClean: false,
    });
    expect(() => parseDeployedSecretMigrationArgs([
      '--project=quantified-self-io',
      '--region=europe-west2',
      '--apply',
    ])).toThrow('requires --confirm-project');
    expect(parseDeployedSecretMigrationArgs([
      '--project=quantified-self-io',
      '--region=europe-west2',
      '--apply',
      '--confirm-project=quantified-self-io',
    ]).apply).toBe(true);
    expect(() => parseDeployedSecretMigrationArgs([
      '--project=quantified-self-io',
      '--region=europe-west2',
      '--apply',
      '--require-clean',
      '--confirm-project=quantified-self-io',
    ])).toThrow('separate operations');
  });
});
