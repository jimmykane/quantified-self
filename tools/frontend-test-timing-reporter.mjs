import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { relativeSpec } from './frontend-test-shards.mjs';

export default class FrontendTimingReporter {
  constructor({ outputFile = process.env.QS_FRONTEND_TIMING_REPORT } = {}) {
    this.outputFile = outputFile;
  }

  onInit(context) {
    this.root = context.config.root;
  }

  onTestRunStart() {
    this.started = performance.now();
  }

  onTestRunEnd(modules, errors, reason) {
    assert(this.outputFile, 'QS_FRONTEND_TIMING_REPORT is required');
    assert(reason === 'passed' && errors.length === 0 && modules.length > 0,
      'Refusing timings from a failed, interrupted or empty frontend run');
    const entries = modules.map(module => {
      const tests = [...module.children.allTests()];
      assert(module.state() === 'passed' && tests.length > 0 && tests.every(test => test.result().state === 'passed'),
        'Refusing timings with failed, skipped or empty tests');
      const diagnostic = module.diagnostic();
      // Count environment, setup and imports as well as assertion bodies.
      const phases = ['environmentSetupDuration', 'prepareDuration', 'collectDuration', 'setupDuration', 'duration'];
      assert(phases.every(key => Number.isFinite(diagnostic[key]) && diagnostic[key] >= 0), 'Invalid Vitest timing diagnostics');
      return { file: relativeSpec(this.root, module.moduleId), project: module.project.name,
        durationMs: Math.max(1, phases.reduce((sum, key) => sum + diagnostic[key], 0)) };
    });
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify({ version: 1, success: true,
      elapsedMs: Math.max(1, performance.now() - this.started), entries }, null, 2)}\n`);
  }
}
