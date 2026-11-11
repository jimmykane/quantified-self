import { describe, expect, it } from 'vitest';
import { getSentryBuildTags, projectSentryBuildTags } from './sentry-build-tags.helper';

describe('Sentry build tags', () => {
  it('keeps a commit, workflow attempt and dirty indicator separate from the release version', () => {
    expect(getSentryBuildTags({ commit: 'a'.repeat(40), run: '123456.2', dirty: false })).toEqual({
      build_commit: 'a'.repeat(40), build_run: '123456.2', build_dirty: 'false',
    });
    expect(getSentryBuildTags({ commit: 'b'.repeat(64), run: 'local', dirty: true })).toEqual({
      build_commit: 'b'.repeat(64), build_run: 'local', build_dirty: 'true',
    });
  });
  it('reports missing build constants honestly for direct CLI builds and unbundled tests', () => {
    expect(getSentryBuildTags()).toEqual({ build_commit: 'unknown', build_run: 'unknown', build_dirty: 'unknown' });
  });
  it.each(['private branch/path', 'abc', '<script>', '1\n', '', null, 123, {}, 'f'.repeat(300), 'a'.repeat(40) + '\n', '123.2\n'])(
    'excludes arbitrary or malformed metadata (%j)', value => {
      expect(getSentryBuildTags({ commit: value, run: value, dirty: value })).toEqual({
        build_commit: 'unknown', build_run: 'unknown', build_dirty: 'unknown',
      });
    });
  it('projects valid build identity without widening a diagnostic tag allowlist', () => {
    expect(projectSentryBuildTags({ build_commit: 'a'.repeat(40), build_run: '123.2', build_dirty: 'false',
      privateTag: 'private workout', build_extra: 'private token' })).toEqual({
      build_commit: 'a'.repeat(40), build_run: '123.2', build_dirty: 'false',
    });
    expect(projectSentryBuildTags({ build_commit: 'private branch', build_run: 'private id', build_dirty: 'private text' })).toEqual({});
    expect(projectSentryBuildTags(undefined)).toEqual({});
  });
});
