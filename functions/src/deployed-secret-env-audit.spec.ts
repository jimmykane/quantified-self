import { describe, expect, it } from 'vitest';
import { SECRET_PARAMS } from './secrets';
import {
  createDeployedSecretEnvironmentAudit,
  parseDeployedSecretAuditArgs,
} from './deployed-secret-env-audit';

describe('deployed Function secret environment audit', () => {
  it('reports plaintext, binding, state, and missing-endpoint violations', () => {
    const audit = createDeployedSecretEnvironmentAudit([
      {
        name: 'boundFunction',
        region: 'europe-west2',
        state: 'FAILED',
        environmentVariableNames: [
          'FIREBASE_CONFIG',
          'MAPBOX_ACCESS_TOKEN',
          'SENTRY_AUTH_TOKEN',
        ],
        secretEnvironmentVariableNames: ['GEMINI_API_KEY'],
      },
      {
        name: 'publicFunction',
        region: 'europe-west3',
        state: 'ACTIVE',
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

    expect(audit.missingDeployedFunctions).toEqual(['missingFunction']);
    expect(audit.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('boundFunction: deployed state is FAILED'),
      expect.stringContaining('boundFunction: managed plaintext bindings'),
      expect.stringContaining('boundFunction: expected secrets'),
      expect.stringContaining('publicFunction: managed plaintext bindings'),
    ]));
  });

  it('accepts exact repository bindings and reports extensions separately', () => {
    const audit = createDeployedSecretEnvironmentAudit([
      {
        name: 'boundFunction',
        region: 'europe-west2',
        state: 'ACTIVE',
        environmentVariableNames: ['FIREBASE_CONFIG'],
        secretEnvironmentVariableNames: ['MAPBOX_ACCESS_TOKEN'],
      },
      {
        name: 'publicFunction',
        region: 'europe-west3',
        state: 'ACTIVE',
        environmentVariableNames: ['FIREBASE_CONFIG'],
        secretEnvironmentVariableNames: [],
      },
      {
        name: 'extensionFunction',
        region: 'europe-west3',
        state: 'ACTIVE',
        environmentVariableNames: [],
        secretEnvironmentVariableNames: [],
      },
    ], ['boundFunction', 'publicFunction'], {
      boundFunction: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
    });

    expect(audit).toEqual({
      missingDeployedFunctions: [],
      unmanagedDeployedFunctions: ['europe-west3/extensionFunction'],
      violations: [],
    });
  });

  it('rejects duplicate deployed bindings for the same secret', () => {
    const audit = createDeployedSecretEnvironmentAudit([
      {
        name: 'boundFunction',
        region: 'europe-west2',
        state: 'ACTIVE',
        environmentVariableNames: ['FIREBASE_CONFIG'],
        secretEnvironmentVariableNames: [
          'MAPBOX_ACCESS_TOKEN',
          'MAPBOX_ACCESS_TOKEN',
        ],
      },
    ], ['boundFunction'], {
      boundFunction: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
    });

    expect(audit.violations).toEqual([
      expect.stringContaining(
        'expected secrets [MAPBOX_ACCESS_TOKEN], found [MAPBOX_ACCESS_TOKEN, MAPBOX_ACCESS_TOKEN]',
      ),
    ]);
  });

  it('accepts one or several regions and rejects every mutation flag', () => {
    expect(parseDeployedSecretAuditArgs([
      '--project=quantified-self-io',
      '--region=europe-west2',
    ])).toEqual({
      projectId: 'quantified-self-io',
      regions: ['europe-west2'],
    });
    expect(parseDeployedSecretAuditArgs([
      '--project=quantified-self-io',
      '--regions=europe-west2,europe-west3',
    ]).regions).toEqual(['europe-west2', 'europe-west3']);
    expect(() => parseDeployedSecretAuditArgs([
      '--project=quantified-self-io',
      '--region=europe-west2',
      '--regions=europe-west2,europe-west3',
    ])).toThrow('either --region or --regions');
    expect(() => parseDeployedSecretAuditArgs([
      '--project=quantified-self-io',
      '--regions=europe-west2,europe-west2',
    ])).toThrow('valid --region');
    expect(() => parseDeployedSecretAuditArgs([
      '--project=quantified-self-io',
      '--regions=europe-west2,europe-west3',
      '--apply',
    ])).toThrow('Unknown argument: --apply');
    expect(() => parseDeployedSecretAuditArgs([
      '--project=quantified-self-io',
      '--regions=europe-west2,europe-west3',
      '--confirm-project=quantified-self-io',
    ])).toThrow('Unknown argument: --confirm-project');
  });
});
