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
    expect(testingWorkflow).toContain(
      "if: github.event_name != 'pull_request' || github.head_ref != 'develop'",
    );
    expect(betaWorkflow).toMatch(
      /test:\s*\n\s+uses: \.\/\.github\/workflows\/_run-tests\.yml/,
    );
    expect(betaWorkflow).toMatch(/deploy:\s*\n\s+needs: test/);
  });
});
