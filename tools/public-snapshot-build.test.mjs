import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';

const root = new URL('../', import.meta.url);
const { scripts, devDependencies } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('every build refreshes both snapshots and requires their validated server files', () => {
  for (const name of ['build', 'build-beta', 'build-production']) {
    assert.match(scripts[name], /^npm run generate:public-snapshots && /);
    assert.match(scripts[name], /QS_REQUIRE_PUBLIC_PRICING_SNAPSHOT=true/);
    assert.match(scripts[name], /QS_REQUIRE_PUBLIC_RELEASES_SNAPSHOT=true/);
  }
  assert.match(scripts['test:public-snapshots'], /public-snapshot-firestore.test.mjs/);
  assert.match(scripts['test:public-snapshots'], /generate-public-releases-snapshot.test.mjs/);
  assert.ok(devDependencies['google-auth-library']);
});

test('protected Hosting builds supply ADC through the existing service-account WIF setup before building', () => {
  for (const [file, account, build, environment] of [
    ['buildAndDeployMain.yml', 'qs-github-production-hosting', 'build-production', 'production-hosting'],
    ['buildAndDeployBeta.yml', 'qs-github-beta-hosting', 'build-beta', 'beta-hosting'],
  ]) {
    const workflow = load(readFileSync(new URL(`.github/workflows/${file}`, root), 'utf8'));
    const job = workflow.jobs.deploy;
    const authIndex = job.steps.findIndex(step => step.uses?.startsWith('google-github-actions/auth@'));
    const buildIndex = job.steps.findIndex(step => step.run?.includes(`npm run ${build}`));
    assert.ok(authIndex >= 0 && authIndex < buildIndex);
    assert.equal(job.environment, environment);
    assert.equal(job.permissions['id-token'], 'write');
    const auth = job.steps[authIndex].with;
    assert.equal(auth.service_account, `${account}@quantified-self-io.iam.gserviceaccount.com`);
    assert.equal(auth.create_credentials_file, true);
    assert.equal(auth.export_environment_variables, true);
    assert.equal(auth.credentials_json, undefined);
  }
  assert.match(readFileSync(new URL('.gitignore', root), 'utf8'), /^gha-creds-\*\.json$/m);
});
