import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const testingWorkflow = readFileSync(
  resolve(__dirname, '../.github/workflows/testing.yaml'),
  'utf8',
);
const betaWorkflow = readFileSync(
  resolve(__dirname, '../.github/workflows/buildAndDeployBeta.yml'),
  'utf8',
);

describe('GitHub Actions configuration', () => {
  it('tests develop once in the beta workflow before deployment', () => {
    expect(testingWorkflow).not.toContain('pull_request:');
    expect(testingWorkflow).toMatch(
      /push:\s*\n\s+branches-ignore:\s*\n\s+- develop\s*\n\s+- main/,
    );
    expect(betaWorkflow).toMatch(
      /run-tests:\s*\n\s+uses: \.\/\.github\/workflows\/_run-tests\.yml/,
    );
    expect(betaWorkflow).toMatch(/deploy:\s*\n\s+needs: run-tests/);
  });
});
