import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { startLocalProcesses } from './start-local.mjs';
import { readLocalRuntimeConfiguration } from './local-runtime.mjs';

test('starts a Functions watcher and stops every child on interruption or compiler failure', async t => {
  for (const stop of ['SIGINT', 'SIGTERM', 'compiler-failure']) {
    await t.test(stop, async () => {
      const signals = new EventEmitter();
      const children = [];
      const invocations = [];
      const { runtimeConfig } = await readLocalRuntimeConfiguration();
      const spawnProcess = invocation => {
        invocations.push(invocation);
        const child = new EventEmitter();
        child.exitCode = null;
        child.signalCode = null;
        child.kill = signal => {
          child.signalCode = signal;
          queueMicrotask(() => child.emit('exit', null, signal));
        };
        children.push(child);
        if (children.length === 3) setImmediate(() => {
          if (stop === 'compiler-failure') {
            children[1].exitCode = 2;
            children[1].emit('exit', 2, null);
          } else signals.emit(stop);
        });
        return child;
      };
      try {
        await startLocalProcesses(runtimeConfig, {}, { spawnProcess, waitUntilReady: async () => {}, signals });
        assert.equal(invocations.length, 3);
        assert.ok(invocations[1].args.includes('--watch'));
        assert.match(invocations[1].args[invocations[1].args.indexOf('--project') + 1], /functions[/\\]tsconfig\.json$/u);
        assert.ok(invocations[2].args.includes('local'));
        assert.ok(children.every(child => child.exitCode !== null || child.signalCode === 'SIGINT'));
        assert.equal(process.exitCode, stop === 'compiler-failure' ? 2 : 0);
        assert.equal(signals.listenerCount('SIGINT'), 0);
        assert.equal(signals.listenerCount('SIGTERM'), 0);
      } finally {
        process.exitCode = 0;
      }
    });
  }
});

test('interrupting startup cancels readiness and never launches Angular or the watcher', async () => {
  const signals = new EventEmitter();
  const { runtimeConfig } = await readLocalRuntimeConfiguration();
  let starts = 0;
  const firebase = new EventEmitter();
  firebase.exitCode = null;
  firebase.signalCode = null;
  firebase.kill = signal => {
    firebase.signalCode = signal;
    queueMicrotask(() => firebase.emit('exit', null, signal));
  };
  try {
    await startLocalProcesses(runtimeConfig, {}, {
      signals,
      spawnProcess: () => { starts++; return firebase; },
      waitUntilReady: (_config, _timeout, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        setImmediate(() => signals.emit('SIGINT'));
      }),
    });
    assert.equal(starts, 1);
    assert.equal(firebase.signalCode, 'SIGINT');
    assert.equal(signals.listenerCount('SIGINT'), 0);
  } finally {
    process.exitCode = 0;
  }
});
