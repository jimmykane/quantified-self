import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

interface WorkflowConfig {
  on: {
    push: { branches?: string[]; 'branches-ignore'?: string[] };
    pull_request?: { types: string[] };
  };
  jobs: Record<string, { uses?: string; needs?: string; if?: string }>;
}

const testingWorkflow = load(readFileSync(
  resolve(__dirname, '../.github/workflows/testing.yaml'),
  'utf8',
)) as WorkflowConfig;
const betaWorkflow = load(readFileSync(
  resolve(__dirname, '../.github/workflows/buildAndDeployBeta.yml'),
  'utf8',
)) as WorkflowConfig;

describe('GitHub Actions configuration', () => {
  it('tests develop once in the beta workflow before deployment', () => {
    expect(testingWorkflow.on.push['branches-ignore']).toEqual(['develop', 'main']);
    expect(betaWorkflow.on.push.branches).toEqual(['develop']);
    expect(betaWorkflow.on.pull_request).toBeUndefined();
    expect(betaWorkflow.jobs['run-tests'].uses).toBe('./.github/workflows/_run-tests.yml');
    expect(betaWorkflow.jobs.deploy.needs).toBe('run-tests');
  });

  it('allows fork pull requests while internal pull requests reuse their push tests', () => {
    expect(testingWorkflow.on.pull_request?.types).toEqual(['opened', 'synchronize', 'reopened']);
    expect(testingWorkflow.jobs['run-tests'].if).toBe(
      "${{ github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository) }}",
    );
  });
});
