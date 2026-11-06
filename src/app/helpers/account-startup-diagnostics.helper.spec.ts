import { describe, expect, it, vi } from 'vitest';
import { AccountStartupDiagnostics } from './account-startup-diagnostics.helper';

describe('AccountStartupDiagnostics', () => {
  it('identifies outstanding credentials and the exact pending profile document without their values', () => {
    let now = 100;
    const capture = vi.fn();
    const diagnostics = new AccountStartupDiagnostics(capture, () => now);
    const auth = diagnostics.begin('auth-token');
    diagnostics.begin('browser-verification');
    now += 200;
    diagnostics.complete(auth);
    expect(diagnostics.snapshot().activeStages).toEqual(['browser-verification']);
    const listener = diagnostics.begin('profile-listener');
    for (const kind of ['user', 'legal', 'system'] as const) diagnostics.documentReady(listener, kind);
    now += 10_000;
    diagnostics.failed(listener, { code: 'deadline-exceeded', token: 'private-token', uid: 'private-owner' });
    expect(capture).toHaveBeenCalledWith('Account startup stage failed', expect.objectContaining({
      tags: { startup_stage: 'profile-listener', startup_error_code: 'deadline-exceeded' },
      contexts: { accountStartup: expect.objectContaining({
        pendingProfileDocuments: ['settings'], stageElapsedMs: 10_000,
        completedStageMs: { 'auth-token': 200 },
      }) },
    }));
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private');
  });

  it('distinguishes profile merging from waiting for server documents', () => {
    const capture = vi.fn();
    const diagnostics = new AccountStartupDiagnostics(capture);
    const listener = diagnostics.begin('profile-listener');
    for (const kind of ['user', 'legal', 'system', 'settings'] as const) diagnostics.documentReady(listener, kind);
    diagnostics.failed(listener, { code: 'private-code', message: 'private-message' });
    expect(capture.mock.calls[0][1].tags).toEqual({ startup_stage: 'profile-merge', startup_error_code: 'unknown' });
    diagnostics.complete(listener);
    diagnostics.ready();
    diagnostics.ready();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1][0]).toBe('Account startup recovered');
  });

  it('ignores cancelled and superseded handles, including late outcomes after an account change', () => {
    const capture = vi.fn();
    const diagnostics = new AccountStartupDiagnostics(capture);
    const old = diagnostics.begin('profile-listener');
    const current = diagnostics.begin('profile-listener');
    diagnostics.cancel(old);
    diagnostics.documentReady(old, 'user');
    diagnostics.failed(old, { code: 'deadline-exceeded' });
    expect(diagnostics.snapshot().pendingProfileDocuments).toHaveLength(4);
    diagnostics.reset();
    diagnostics.complete(current);
    diagnostics.failed(current, { code: 'deadline-exceeded' });
    expect(diagnostics.snapshot().activeStages).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it('deduplicates failures, caps the page-wide budget and contains reporting failures', () => {
    const capture = vi.fn(() => { throw new Error('private telemetry failure'); });
    const diagnostics = new AccountStartupDiagnostics(capture);
    for (let i = 0; i < 20; i++) {
      const attempt = diagnostics.begin('auth-token');
      diagnostics.failed(attempt, { code: 'deadline-exceeded' });
      diagnostics.failed(attempt, { code: 'deadline-exceeded' });
      diagnostics.ready();
      diagnostics.reset();
    }
    expect(capture).toHaveBeenCalledTimes(8);
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private');
  });
});
