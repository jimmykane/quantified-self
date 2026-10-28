import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BaseSequencer } from 'vitest/node';
import { assertPlan, relativeSpec, specKey } from './frontend-test-shards.mjs';

export default class FrontendSequencer extends BaseSequencer {
  async shard(files) {
    const path = process.env.QS_FRONTEND_SHARD_PLAN;
    if (!path) return super.shard(files);
    const { root, shard } = this.ctx.config;
    const plan = JSON.parse(readFileSync(path, 'utf8'));
    const specs = files.map(file => ({ file: relativeSpec(root, file.moduleId), project: file.project.name }));
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    assertPlan(plan, specs, { revision, count: shard.count });
    assert(Number.isSafeInteger(shard.index) && shard.index >= 1 && shard.index <= plan.shards.length, 'Invalid shard index');
    const selected = new Set(plan.shards[shard.index - 1].specs.map(specKey));
    return files.filter((_, index) => selected.has(specKey(specs[index])));
  }

  async sort(files) {
    if (!process.env.QS_FRONTEND_SHARD_PLAN) return super.sort(files);
    const plan = JSON.parse(readFileSync(process.env.QS_FRONTEND_SHARD_PLAN, 'utf8'));
    const weights = new Map(plan.shards.flatMap(shard => shard.specs).map(spec => [specKey(spec), spec.estimatedMs]));
    const key = file => specKey({ file: relativeSpec(this.ctx.config.root, file.moduleId), project: file.project.name });
    // Start the expensive modules first within each two-worker runner.
    return [...files].sort((a, b) => weights.get(key(b)) - weights.get(key(a)) || key(a).localeCompare(key(b)));
  }
}
